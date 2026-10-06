/// API v1 handlers. Each resolves the party a tenant is acting for, checks the tenant holds that
/// party's permission for the scope, then calls the same service function the web app calls with
/// that party's address in place of a session. Every existing rule (party-only access, signature
/// checks against the chain, row locks, ledger reconciliation) applies unchanged. Nothing here
/// signs anything: the API only ever accepts signatures the parties made.

import { encodeFunctionData, getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { contraflowNettingLedgerAbi } from "../contracts/abi/index";
import { certificateTypedData } from "../netting/certificate";
import { obligationTypedData } from "../netting/obligation";
import { parseCertificateView, parseObligationJson } from "../netting/serialize";
import { typedDataResponse } from "./typedDataJson";
import type { LedgerDomain } from "../netting/types";
import type { ChainReader } from "../netting/signature";
import type { CertificateService } from "../obligations/certificates";
import type * as obligationService from "../obligations/service";
import { ApiError, requirePartyScope, type ApiCaller, type IdempotencyContext, type TenantStore } from "./auth";
import { permissionTypedData, validatePermission, type TenantPermission } from "./permissions";

export interface ApiDeps {
  store: TenantStore;
  client: ChainReader;
  domain: LedgerDomain;
  nowSeconds(): bigint;
  newId(): string;
  obligations: Pick<
    typeof obligationService,
    "createProposal" | "getProposal" | "getProposalForObligation" | "acceptProposal" | "withdrawProposal" | "listMine"
  >;
  certificates: Pick<
    CertificateService,
    "listCertificates" | "findAndProposeLoop" | "getCertificateView" | "submitCertificateSignature" | "recordApplicationTx" | "exportCertificate"
  >;
  tagProposal(token: string, tenantId: Hex): Promise<void>;
}

export interface ApiRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  idempotency?: IdempotencyContext;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

type ServiceResult = { ok: true } | { ok: false; error: string };

/// Service errors are fixed strings: "Not found." stays a 404 so a tenant can't probe for rows it
/// has no right to, and a rate limit is a 429. Anything else is a request the service refused.
function unwrap<T extends ServiceResult>(result: T): Extract<T, { ok: true }> {
  if (result.ok) return result as Extract<T, { ok: true }>;
  const error = (result as { error: string }).error;
  if (error === "Not found.") throw new ApiError(404, "not_found", "Not found.");
  if (error.startsWith("Too many requests")) throw new ApiError(429, "rate_limited", error);
  throw new ApiError(422, "rejected", error);
}

function field(body: unknown, name: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[name] : undefined;
}

function partyFrom(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new ApiError(422, "invalid_party", "party must be an address.");
  return getAddress(value);
}

function assertAppChain(caller: ApiCaller, deps: ApiDeps) {
  if (BigInt(caller.chainId) !== deps.domain.chainId) {
    throw new ApiError(403, "chain_unavailable", "Offchain obligations aren't available on this network yet.");
  }
}

async function actingParty(caller: ApiCaller, value: unknown, scope: Parameters<typeof requirePartyScope>[2], deps: ApiDeps) {
  assertAppChain(caller, deps);
  const party = partyFrom(value);
  await requirePartyScope(caller, party, scope, deps.store, deps.nowSeconds());
  return party;
}

// Permissions

export async function permissionPayload(caller: ApiCaller, req: ApiRequest): Promise<ApiResponse> {
  const party = partyFrom(req.query.get("party"));
  const scopes = Number(req.query.get("scopes"));
  const expiresAt = req.query.get("expiresAt");
  const nonce = req.query.get("nonce");
  if (!expiresAt || !/^\d+$/.test(expiresAt)) throw new ApiError(422, "invalid_request", "expiresAt must be a unix timestamp.");
  if (!nonce || !isHex(nonce) || nonce.length !== 66) throw new ApiError(422, "invalid_request", "nonce must be 32 bytes of hex.");
  const permission: TenantPermission = { party, tenantId: caller.tenantId, scopes, expiresAt: BigInt(expiresAt), nonce };
  return { status: 200, body: typedDataResponse(permissionTypedData(caller.chainId, permission)) };
}

export async function createPermission(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const result = await validatePermission(field(req.body, "permission"), field(req.body, "signature"), {
    chainId: caller.chainId,
    tenantId: caller.tenantId,
    nowSeconds: deps.nowSeconds(),
    client: deps.client,
  });
  if (!result.ok) throw new ApiError(422, "invalid_permission", result.error);
  const { permission } = result;
  const permissionId = deps.newId();
  const saved = await deps.store.savePermission({
    permissionId,
    tenantId: caller.tenantId,
    chainId: caller.chainId,
    party: permission.party,
    scopes: permission.scopes,
    expiresAt: permission.expiresAt,
    nonce: permission.nonce,
    signature: field(req.body, "signature") as Hex,
  }, req.idempotency);
  if (!saved) throw new ApiError(409, "duplicate_nonce", "This party already granted a permission with this nonce.");
  return {
    status: 201,
    body: { permissionId, party: permission.party, scopes: permission.scopes, expiresAt: permission.expiresAt },
  };
}

export async function revokePermission(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const revoked = await deps.store.revokePermission(caller.tenantId, req.params.permissionId ?? "");
  if (!revoked) throw new ApiError(404, "not_found", "Not found.");
  return { status: 204, body: null };
}

// Obligations

function proposalWithPayload(proposal: obligationService.ProposalView) {
  const domain: LedgerDomain = { chainId: BigInt(proposal.domain.chainId), verifyingContract: proposal.domain.verifyingContract };
  const obligation = parseObligationJson(proposal.obligation);
  const envelope = typedDataResponse(obligationTypedData(obligation, domain));
  return { ...proposal, typedData: envelope.typedData, digest: envelope.digest };
}

/// If a create already stored the proposal, return that 201 instead of re-inserting.
export async function recoverCreateObligationProposal(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse | null> {
  const party = await actingParty(caller, field(req.body, "party"), "propose", deps);
  const found = await deps.obligations.getProposalForObligation(party, field(req.body, "obligation"));
  if (!found.ok) return null;
  return { status: 201, body: { proposal: proposalWithPayload(found.proposal) } };
}

export async function recoverAcceptObligationProposal(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse | null> {
  const party = await actingParty(caller, field(req.body, "party"), "deliverSignatures", deps);
  const { proposal } = unwrap(await deps.obligations.getProposal(party, req.params.token));
  if (proposal.state !== "accepted") return null;
  return { status: 200, body: { accepted: true } };
}

export async function recoverFindLoop(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse | null> {
  const party = await actingParty(caller, req.params.address, "propose", deps);
  const { certificates } = unwrap(await deps.certificates.listCertificates(party));
  const open = certificates.find((c) => c.status === "collecting" || c.status === "ready");
  if (!open) return null;
  return {
    status: 200,
    body: { outcome: { found: true, token: open.token, currency: open.currency, wNet: open.wNet, parties: open.parties } },
  };
}

export async function recoverSignCertificate(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse | null> {
  const party = await actingParty(caller, field(req.body, "party"), "deliverSignatures", deps);
  const { certificate } = unwrap(await deps.certificates.getCertificateView(party, req.params.token));
  if (!certificate.youSigned) return null;
  return { status: 200, body: { signed: true } };
}

export async function recoverReportTransaction(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse | null> {
  const party = await actingParty(caller, field(req.body, "party"), "read", deps);
  const txHash = field(req.body, "txHash");
  if (typeof txHash !== "string") return null;
  const { certificate } = unwrap(await deps.certificates.getCertificateView(party, req.params.token));
  if (!certificate.appliedTxHash || certificate.appliedTxHash.toLowerCase() !== txHash.toLowerCase()) return null;
  return { status: 200, body: { status: certificate.status } };
}

export async function createObligationProposal(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, field(req.body, "party"), "propose", deps);
  const { token } = unwrap(
    await deps.obligations.createProposal(party, {
      obligation: field(req.body, "obligation"),
      document: field(req.body, "document"),
      proposerRole: field(req.body, "proposerRole"),
      proposerSignature: field(req.body, "proposerSignature"),
    }),
  );
  await deps.tagProposal(token, caller.tenantId);
  const { proposal } = unwrap(await deps.obligations.getProposal(party, token));
  return { status: 201, body: { proposal: proposalWithPayload(proposal) } };
}

export async function getObligationProposal(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.query.get("party"), "read", deps);
  const { proposal } = unwrap(await deps.obligations.getProposal(party, req.params.token));
  return { status: 200, body: { proposal: proposalWithPayload(proposal) } };
}

export async function acceptObligationProposal(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, field(req.body, "party"), "deliverSignatures", deps);
  unwrap(await deps.obligations.acceptProposal(party, req.params.token, field(req.body, "signature")));
  return { status: 200, body: { accepted: true } };
}

export async function withdrawObligationProposal(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.query.get("party"), "propose", deps);
  unwrap(await deps.obligations.withdrawProposal(party, req.params.token));
  return { status: 204, body: null };
}

export async function listPartyObligations(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.params.address, "read", deps);
  // Certificates first: listing them brings any the ledger has applied up to date.
  const { certificates } = unwrap(await deps.certificates.listCertificates(party));
  const { proposals, obligations } = unwrap(await deps.obligations.listMine(party));
  return { status: 200, body: { proposals, obligations, certificates } };
}

export async function findLoop(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.params.address, "propose", deps);
  const result = unwrap(await deps.certificates.findAndProposeLoop(party));
  return { status: 200, body: result };
}

// Certificates

async function certificateFor(party: Address, token: string | undefined, deps: ApiDeps) {
  const { certificate } = unwrap(await deps.certificates.getCertificateView(party, token));
  return { certificate, view: parseCertificateView(certificate.view) };
}

export async function getCertificate(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.query.get("party"), "read", deps);
  const { certificate, view } = await certificateFor(party, req.params.token, deps);
  const envelope = typedDataResponse(certificateTypedData(view.certificate, view.domain));
  return {
    status: 200,
    body: {
      certificate: { ...certificate, view: JSON.parse(certificate.view) },
      typedData: envelope.typedData,
      digest: envelope.digest,
    },
  };
}

export async function signCertificate(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, field(req.body, "party"), "deliverSignatures", deps);
  unwrap(await deps.certificates.submitCertificateSignature(party, req.params.token, field(req.body, "signature")));
  return { status: 200, body: { signed: true } };
}

/// Applying is permissionless and costs gas, so Contraflow never submits it: the tenant or a party
/// sends this transaction from its own wallet, then reports the hash.
export async function applyTransaction(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.query.get("party"), "read", deps);
  const { certificate, view } = await certificateFor(party, req.params.token, deps);
  if (certificate.status !== "ready" || view.signatures.some((s) => s === null)) {
    throw new ApiError(409, "not_ready", "The certificate isn't signed by every party yet.");
  }
  return {
    status: 200,
    body: {
      chainId: view.domain.chainId,
      to: view.domain.verifyingContract,
      value: "0",
      data: encodeFunctionData({
        abi: contraflowNettingLedgerAbi,
        functionName: "applyCertificate",
        args: [view.certificate, view.signatures as Hex[]],
      }),
      note: "Submit this from your own wallet; the sender pays the gas. Then report the hash to /transactions.",
    },
  };
}

export async function reportTransaction(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, field(req.body, "party"), "read", deps);
  const result = unwrap(await deps.certificates.recordApplicationTx(party, req.params.token, field(req.body, "txHash")));
  return { status: 200, body: { status: result.status } };
}

export async function exportCertificate(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.query.get("party"), "read", deps);
  const { json, fileName } = unwrap(await deps.certificates.exportCertificate(party, req.params.token));
  return { status: 200, body: { fileName, certificate: JSON.parse(json) } };
}
