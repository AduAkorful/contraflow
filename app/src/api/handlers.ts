/// API v1 handlers. Each resolves the party a tenant is acting for, checks the tenant holds that
/// party's permission for the scope, then calls the same service function the web app calls with
/// that party's address in place of a session. Every existing rule (party-only access, signature
/// checks against the chain, row locks, ledger reconciliation) applies unchanged. Nothing here
/// signs anything: the API only ever accepts signatures the parties made.

import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
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
import { permissionTypedData, parsePermissionGrant, validatePermission } from "./permissions";
import { removeOwnWebhook, rollOwnWebhookSecret, setOwnWebhook, type OwnWebhookStore } from "./ownWebhook";
import type { ResolveAll } from "./webhookUrl";
import { paginatePartyLists, parsePageCursor, parsePageLimit } from "./pagination";
import { parseUsageRange, type TenantUsage, type UsageRecord } from "./usage";
import { amountFieldsFromMajor, amountFieldsFromMinor, apiChainId, appUrl, unixSeconds } from "./wire";

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
    "listCertificates" | "declineCertificate" | "disputeObligation" | "withdrawDispute" | "getMyRules" | "setMyRules" | "findAndProposeLoop" | "getCertificateView" | "submitCertificateSignature" | "recordApplicationTx" | "exportCertificate"
  >;
  tagProposal(token: string, tenantId: Hex): Promise<void>;
  /// The tenant's webhook endpoint, keyed by tenant id. Plain `http://localhost` receivers are
  /// accepted only where `allowLocalWebhooks` is set (never in production).
  webhookEndpoint: OwnWebhookStore;
  allowLocalWebhooks?: boolean;
  /// The gas an apply transaction is expected to use and the current gas price, for the response's
  /// cost hint. Optional; the hint is `null` when unavailable.
  estimateApply?(tx: { to: Address; data: Hex; from: Address }): Promise<{ gas: bigint; gasPrice: bigint } | null>;
  /// The tenant's recorded events, for `GET /events`.
  eventLog?: {
    list(tenantId: Hex, afterSeq: string, limit: number): Promise<{ seq: string; body: string; status: string }[]>;
    /// Same recheck delivery does: tenant active and read permission still live for every party named.
    canRead(tenantId: Hex, body: string, nowSeconds: bigint): Promise<boolean>;
  };
  /// Hostname lookup for endpoint validation; defaults to DNS.
  resolveWebhookHost?: ResolveAll;
  enqueueWebhookTest(tenantId: Hex, chainId: number): Promise<{ eventId: string } | { error: "no_endpoint" }>;
  /// Counts a call for the tenant's usage view. Best-effort: optional so a deployment without it
  /// still serves the API.
  recordUsage?(record: UsageRecord): Promise<void>;
  getUsage?(query: { tenantId: string; from: string; to: string; party?: string; cursor?: string; nowSeconds: bigint }): Promise<TenantUsage>;
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
  if (error.startsWith("Another search took")) throw new ApiError(409, "conflict", error);
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

export async function permissionPayload(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const scopesRaw = req.query.get("scopes");
  const parsed = parsePermissionGrant(
    {
      party: req.query.get("party"),
      tenantId: caller.tenantId,
      scopes: scopesRaw !== null && /^-?\d+$/.test(scopesRaw) ? Number(scopesRaw) : Number.NaN,
      expiresAt: req.query.get("expiresAt"),
      nonce: req.query.get("nonce"),
    },
    { tenantId: caller.tenantId, nowSeconds: deps.nowSeconds() },
  );
  if (!parsed.ok) throw new ApiError(422, "invalid_request", parsed.error);
  return { status: 200, body: typedDataResponse(permissionTypedData(caller.chainId, parsed.permission)) };
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

export async function listPermissions(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const partyParam = req.query.get("party");
  const party = partyParam ? partyFrom(partyParam) : undefined;
  const permissions = await deps.store.listPermissions(caller.tenantId, caller.chainId, party);
  return {
    status: 200,
    body: {
      permissions: permissions.map((p) => ({
        permissionId: p.permissionId,
        party: p.party,
        scopes: p.scopes,
        expiresAt: p.expiresAt,
        revoked: p.revoked,
        expired: BigInt(p.expiresAt) <= deps.nowSeconds(),
        status: p.revoked ? "revoked" : BigInt(p.expiresAt) <= deps.nowSeconds() ? "expired" : "active",
      })),
    },
  };
}

export async function getTenant(caller: ApiCaller, _req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const tenant = await deps.store.getTenant(caller.tenantId);
  if (!tenant) throw new ApiError(404, "not_found", "Not found.");
  return {
    status: 200,
    body: {
      tenantId: caller.tenantId,
      name: tenant.name,
      status: tenant.status,
      mode: caller.mode,
      chainId: apiChainId(caller.chainId),
      /// The ledger contract on this key's chain: the `verifyingContract` parties sign under.
      ledger: deps.domain.verifyingContract,
      webhookConfigured: tenant.webhookConfigured,
    },
  };
}

export async function getUsage(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  if (!deps.getUsage) throw new ApiError(503, "unavailable", "Usage isn't available right now.");
  const range = parseUsageRange(req.query.get("from"), req.query.get("to"), new Date(Number(deps.nowSeconds()) * 1000));
  if (!range.ok) throw new ApiError(422, "invalid_request", range.message);
  const partyParam = req.query.get("party");
  const party = partyParam ? partyFrom(partyParam) : undefined;
  const cursorParam = req.query.get("cursor");
  if (cursorParam !== null && !isAddress(cursorParam)) throw new ApiError(422, "invalid_request", "cursor is not valid.");
  const usage = await deps.getUsage({
    tenantId: caller.tenantId,
    from: range.from,
    to: range.to,
    party,
    cursor: cursorParam ?? undefined,
    nowSeconds: deps.nowSeconds(),
  });
  return { status: 200, body: usage };
}

/// Native USDC has 18 decimals; shown to 6 places, rounded up so a cost is never understated.
function formatNativeUsdc(wei: bigint): string {
  const unit = 10n ** 12n;
  const micro = (wei + unit - 1n) / unit;
  return `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, "0")}`;
}

function unixOf(iso: string | null): string | null {
  return iso === null ? null : String(Math.floor(new Date(iso).getTime() / 1000));
}

export async function getWebhookEndpoint(caller: ApiCaller, _req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const [endpoint, deliveries] = await Promise.all([deps.webhookEndpoint.get(caller.tenantId), deps.webhookEndpoint.recent(caller.tenantId)]);
  return {
    status: 200,
    body: {
      endpoint: endpoint ? { url: endpoint.url, secretRollingUntil: unixOf(endpoint.rollingUntil) } : null,
      recentDeliveries: deliveries.map((d) => ({
        eventId: d.eventId,
        type: d.type,
        status: d.status,
        attempts: d.attempts,
        createdAt: unixOf(d.createdAt),
        statusCode: d.statusCode,
        error: d.error,
      })),
    },
  };
}

export async function setWebhookEndpoint(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const url = field(req.body, "url");
  if (typeof url !== "string") throw new ApiError(422, "invalid_request", "url must be a string.");
  const result = await setOwnWebhook(caller.tenantId, url, deps.webhookEndpoint, { allowLocalHttp: deps.allowLocalWebhooks === true, resolve: deps.resolveWebhookHost });
  if (!result.ok) throw new ApiError(422, "invalid_request", result.error);
  return { status: 200, body: { url: url.trim(), secret: result.secret } };
}

export async function rollWebhookSecret(caller: ApiCaller, _req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const result = await rollOwnWebhookSecret(caller.tenantId, deps.webhookEndpoint);
  if (!result.ok) throw new ApiError(422, "no_webhook", result.error);
  return { status: 200, body: { secret: result.secret, previousSecretValidFor: "24 hours" } };
}

export async function deleteWebhookEndpoint(caller: ApiCaller, _req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const result = await removeOwnWebhook(caller.tenantId, deps.webhookEndpoint);
  if (!result.ok) throw new ApiError(422, "no_webhook", "No webhook endpoint is registered for this tenant.");
  return { status: 204, body: null };
}

const EVENTS_DEFAULT_LIMIT = 50;
const EVENTS_MAX_LIMIT = 100;

/// A missed-webhook catch-up: the tenant's events after a cursor, oldest first. Events whose
/// parties no longer have a live read permission are left out, as they would not have been sent.
export async function listEvents(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  if (!deps.eventLog) throw new ApiError(503, "unavailable", "Events aren't available right now.");
  const afterRaw = req.query.get("after") ?? "0";
  if (!/^\d{1,18}$/.test(afterRaw)) throw new ApiError(422, "invalid_request", "after must be a cursor returned by a previous call.");
  const limitRaw = req.query.get("limit");
  let limit = EVENTS_DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^\d{1,4}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > EVENTS_MAX_LIMIT) {
      throw new ApiError(422, "invalid_request", `limit must be 1 to ${EVENTS_MAX_LIMIT}.`);
    }
    limit = Number(limitRaw);
  }
  const rows = await deps.eventLog.list(caller.tenantId, afterRaw, limit);
  const now = deps.nowSeconds();
  const events: unknown[] = [];
  for (const row of rows) {
    if (row.status === "suppressed" || !(await deps.eventLog.canRead(caller.tenantId, row.body, now))) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.body) as Record<string, unknown>;
    } catch {
      continue;
    }
    events.push({ ...parsed, cursor: row.seq });
  }
  const last = rows.at(-1);
  return {
    status: 200,
    body: {
      events,
      // Resume from here even when the last events were filtered out.
      nextCursor: last ? last.seq : afterRaw,
      hasMore: rows.length === limit,
    },
  };
}

export async function testWebhook(caller: ApiCaller, _req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const result = await deps.enqueueWebhookTest(caller.tenantId, caller.chainId);
  if ("error" in result) throw new ApiError(422, "no_webhook", "No webhook endpoint is registered for this tenant.");
  return { status: 202, body: { eventId: result.eventId, type: "webhook.test" } };
}

// Obligations

function proposalWithPayload(proposal: obligationService.ProposalView) {
  const domain: LedgerDomain = { chainId: BigInt(proposal.domain.chainId), verifyingContract: proposal.domain.verifyingContract };
  const obligation = parseObligationJson(proposal.obligation);
  const envelope = typedDataResponse(obligationTypedData(obligation, domain));
  return {
    ...proposal,
    domain: { ...proposal.domain, chainId: apiChainId(proposal.domain.chainId) },
    expiresAt: unixSeconds(proposal.expiresAt),
    typedData: envelope.typedData,
    digest: envelope.digest,
    appUrl: appUrl(`/app/o/${proposal.token}`),
  };
}

function certificateSummaryWire<T extends { currency: string; wNet: string; deadline: string; token?: string }>(certificate: T) {
  const { wNet, deadline, ...rest } = certificate;
  const net = amountFieldsFromMinor(wNet, certificate.currency);
  return {
    ...rest,
    wNetMinor: net.amountMinor,
    wNetDisplay: net.amountDisplay,
    deadline: unixSeconds(deadline),
    ...(certificate.token ? { appUrl: appUrl(`/app/c/${certificate.token}`) } : {}),
  };
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
  const net = amountFieldsFromMinor(open.wNet, open.currency);
  return {
    status: 200,
    body: {
      outcome: {
        found: true,
        token: open.token,
        currency: open.currency,
        wNetMinor: net.amountMinor,
        wNetDisplay: net.amountDisplay,
        parties: open.parties,
      },
    },
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

async function proposeOne(caller: ApiCaller, party: Address, input: Record<string, unknown>, deps: ApiDeps): Promise<ApiResponse> {
  const { token, existing } = unwrap(
    await deps.obligations.createProposal(party, {
      obligation: input.obligation,
      document: input.document,
      proposerRole: input.proposerRole,
      proposerSignature: input.proposerSignature,
    }),
  );
  if (existing) {
    throw new ApiError(409, "duplicate_proposal", "This obligation has already been proposed.", {
      proposalToken: token,
      appUrl: appUrl(`/app/o/${token}`),
    });
  }
  await deps.tagProposal(token, caller.tenantId);
  const { proposal } = unwrap(await deps.obligations.getProposal(party, token));
  return { status: 201, body: { proposal: proposalWithPayload(proposal) } };
}

export async function createObligationProposal(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, field(req.body, "party"), "propose", deps);
  return proposeOne(caller, party, (req.body ?? {}) as Record<string, unknown>, deps);
}

export const BATCH_MAX_PROPOSALS = 25;

/// Up to 25 already-signed proposals for one party. Each is validated and counted exactly like a
/// single proposal; a result comes back per item, in order. When the party's write budget runs
/// out the rest are reported as not processed, never silently dropped.
export async function createObligationProposals(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, field(req.body, "party"), "propose", deps);
  const items = field(req.body, "proposals");
  if (!Array.isArray(items) || items.length === 0 || items.length > BATCH_MAX_PROPOSALS) {
    throw new ApiError(422, "invalid_request", `proposals must be a list of 1 to ${BATCH_MAX_PROPOSALS} items.`);
  }
  const results: unknown[] = [];
  let limited = false;
  for (let index = 0; index < items.length; index++) {
    if (limited) {
      results.push({ index, status: 429, error: { code: "rate_limited", message: "Not processed: the party's write budget was used up earlier in this batch." } });
      continue;
    }
    const item = items[index];
    if (!item || typeof item !== "object") {
      results.push({ index, status: 422, error: { code: "invalid_request", message: "Each proposal must be an object." } });
      continue;
    }
    try {
      const res = await proposeOne(caller, party, item as Record<string, unknown>, deps);
      results.push({ index, status: res.status, ...(res.body as object) });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      if (error.status === 429) limited = true;
      results.push({
        index,
        status: error.status,
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      });
    }
  }
  const created = results.filter((r) => (r as { status: number }).status === 201).length;
  return { status: 200, body: { results, created, failed: results.length - created } };
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
  const limit = parsePageLimit(req.query);
  const cursor = parsePageCursor(req.query);
  // Certificates first: listing them brings any the ledger has applied up to date.
  const { certificates } = unwrap(await deps.certificates.listCertificates(party));
  const { proposals, obligations } = unwrap(await deps.obligations.listMine(party));
  const page = paginatePartyLists(proposals, obligations, certificates, limit, cursor);
  return {
    status: 200,
    body: {
      proposals: page.proposals.map((proposal) => {
        const { amount, expiresAt, ...rest } = proposal;
        return {
          ...rest,
          ...amountFieldsFromMajor(amount, proposal.currency),
          expiresAt: unixSeconds(expiresAt),
          appUrl: appUrl(`/app/o/${proposal.token}`),
        };
      }),
      obligations: page.obligations.map((obligation) => {
        const { amount, remaining, status, ...rest } = obligation;
        const face = amountFieldsFromMinor(amount, obligation.currency);
        const left = amountFieldsFromMinor(remaining, obligation.currency);
        // Fully netted is closed, with the reason, so a book can retire it without reading `remaining`.
        const netted = status === "active" && BigInt(remaining) === 0n;
        return {
          ...rest,
          status: netted ? "closed" : status,
          ...(netted ? { closedReason: "netted" } : status === "closed" ? { closedReason: "closed_by_party" } : {}),
          ...face,
          remainingMinor: left.amountMinor,
          remainingDisplay: left.amountDisplay,
        };
      }),
      certificates: page.certificates.map((certificate) => certificateSummaryWire(certificate)),
      nextCursor: page.nextCursor,
    },
  };
}

/// Marks one of the party's obligations disputed: it is left out of loop searches and
/// certificates, and a certificate still collecting signatures is cancelled. Contraflow doesn't
/// decide who is right.
export async function disputeObligationHandler(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, field(req.body, "party"), "propose", deps);
  unwrap(await deps.certificates.disputeObligation(party, req.params.obligationId, field(req.body, "note")));
  return { status: 200, body: { disputed: true } };
}

export async function withdrawDisputeHandler(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.query.get("party"), "propose", deps);
  unwrap(await deps.certificates.withdrawDispute(party, req.params.obligationId));
  return { status: 204, body: null };
}

/// The party's own netting rules (the approved-counterparty list).
export async function getPartyRulesHandler(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.params.address, "read", deps);
  const { rules } = unwrap(await deps.certificates.getMyRules(party));
  return { status: 200, body: { party, allowlistEnabled: rules.enabled, allowed: rules.allowed } };
}

export async function setPartyRulesHandler(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.params.address, "propose", deps);
  const { rules } = unwrap(await deps.certificates.setMyRules(party, field(req.body, "allowlistEnabled"), field(req.body, "allowed")));
  return { status: 200, body: { party, allowlistEnabled: rules.enabled, allowed: rules.allowed } };
}

export async function findLoop(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.params.address, "propose", deps);
  const { outcome } = unwrap(await deps.certificates.findAndProposeLoop(party));
  if (!outcome.found) return { status: 200, body: { outcome } };
  const { wNet, ...rest } = outcome;
  const net = amountFieldsFromMinor(wNet, outcome.currency);
  return {
    status: 200,
    body: { outcome: { ...rest, wNetMinor: net.amountMinor, wNetDisplay: net.amountDisplay, appUrl: appUrl(`/app/c/${outcome.token}`) } },
  };
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
  const { view: storedView, ...summary } = certificate;
  return {
    status: 200,
    body: {
      certificate: { ...certificateSummaryWire(summary), view: JSON.parse(storedView) },
      typedData: envelope.typedData,
      digest: envelope.digest,
    },
  };
}

/// A party in a loop declines a certificate that is still collecting signatures. Its obligations
/// are released and every party can be searched into a new loop. Once every party has signed it
/// can no longer be declined.
export async function declineCertificateHandler(caller: ApiCaller, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const party = await actingParty(caller, req.query.get("party"), "deliverSignatures", deps);
  unwrap(await deps.certificates.declineCertificate(party, req.params.token));
  return { status: 204, body: null };
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
  if (certificate.status === "applied") {
    throw new ApiError(409, "already_applied", "This certificate has already been applied.");
  }
  if (certificate.status === "expired") throw new ApiError(409, "not_ready", "This certificate has expired.");
  if (certificate.status === "abandoned") throw new ApiError(409, "not_ready", "This certificate was cancelled.");
  if (certificate.status !== "ready" || view.signatures.some((s) => s === null)) {
    throw new ApiError(409, "not_ready", "The certificate isn't signed by every party yet.");
  }
  const data = encodeFunctionData({
    abi: contraflowNettingLedgerAbi,
    functionName: "applyCertificate",
    args: [view.certificate, view.signatures as Hex[]],
  });
  const estimate = (await deps.estimateApply?.({ to: view.domain.verifyingContract, data, from: party }).catch(() => null)) ?? null;
  return {
    status: 200,
    body: {
      chainId: apiChainId(view.domain.chainId),
      to: view.domain.verifyingContract,
      value: "0",
      data,
      note: "Submit this from your own wallet; the sender pays the gas. Then report the hash to /transactions.",
      submit: {
        /// Any wallet that holds native USDC for gas can send it; it need not be a party.
        anyFundedWallet: true,
        estimatedGas: estimate ? estimate.gas.toString() : null,
        estimatedCostUsdc: estimate ? formatNativeUsdc(estimate.gas * estimate.gasPrice) : null,
        /// A party can also apply from the Contraflow app with its own wallet.
        appUrl: appUrl(`/app/c/${certificate.token}`),
      },
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
