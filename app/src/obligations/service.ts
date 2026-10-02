/// Server-side proposal and obligation operations behind `/app/obligations` and `/app/o/<token>`.
/// Every function takes the caller's address from the verified session (the Server Actions pass
/// `getSession()`'s address), never from a request parameter. Anyone who isn't one of the two
/// parties gets "Not found", so a lookup can't confirm a proposal or obligation exists.

import { isAddressEqual, isHex, type Address, type Hex } from "viem";
import { createArcPublicClient } from "../chain/client";
import { defaultComplianceProvider } from "../compliance";
import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import {
  acceptProposalWithObligation,
  DuplicateObligationError,
  getObligationById,
  getProposalByToken,
  insertProposal,
  listObligationsForParty,
  listOpenProposalsForParty,
  markProposalWithdrawn,
  obligationExistsForDocument,
  type ObligationStatus,
} from "../db/obligations";
import { checkRateLimit } from "../ratelimit/limiter";
import { ZERO_HASH } from "../netting/commitment";
import { appLedgerDomain } from "../netting/domain";
import { OBLIGATION_DOCUMENT_FORMAT, type CanonicalObligationDocument } from "../netting/document";
import { obligationId } from "../netting/obligation";
import { newProposalToken, isProposalToken } from "./proposalToken";
import { parseObligationJson, serializeObligation, type SerializedObligation } from "../netting/serialize";
import {
  counterpartyRole,
  partyFor,
  signaturesByRole,
  validateAcceptance,
  validateProposal,
  type ProposerRole,
  type SubmissionDeps,
} from "./submission";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_FOUND = "Not found.";
const WRITE_LIMIT = { max: 20, windowSeconds: 600 };
const READ_LIMIT = { max: 120, windowSeconds: 600 };

function submissionDeps(): SubmissionDeps {
  return { client: createArcPublicClient(ARC_TESTNET_CHAIN_ID), complianceProvider: defaultComplianceProvider() };
}

async function rateLimited(kind: string, address: Address, limit: { max: number; windowSeconds: number }) {
  const result = await checkRateLimit(`obligations:${kind}:${address.toLowerCase()}`, limit.max, limit.windowSeconds);
  return !result.allowed;
}

/// Rebuilds a document from untrusted JSON, keeping only its known fields.
function toDocument(raw: unknown): CanonicalObligationDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.format !== OBLIGATION_DOCUMENT_FORMAT) return null;
  for (const key of ["description", "debtor", "creditor", "currency", "amount", "maturity"]) {
    if (typeof d[key] !== "string") return null;
  }
  if (typeof d.earlyNetConsent !== "boolean") return null;
  return {
    format: OBLIGATION_DOCUMENT_FORMAT,
    description: d.description as string,
    debtor: d.debtor as Address,
    creditor: d.creditor as Address,
    currency: d.currency as string,
    amount: d.amount as string,
    maturity: d.maturity as string,
    earlyNetConsent: d.earlyNetConsent,
  };
}

function isRole(value: unknown): value is ProposerRole {
  return value === "debtor" || value === "creditor";
}

export interface CreateProposalInput {
  obligation: unknown;
  document: unknown;
  proposerRole: unknown;
  proposerSignature: unknown;
}

export async function createProposal(session: Address, input: CreateProposalInput): Promise<Result<{ token: string }>> {
  if (await rateLimited("write", session, WRITE_LIMIT)) return { ok: false, error: "Too many requests. Try again shortly." };

  let obligation;
  try {
    obligation = parseObligationJson(input.obligation);
  } catch {
    return { ok: false, error: "Invalid obligation." };
  }
  const document = toDocument(input.document);
  if (!document) return { ok: false, error: "Invalid document." };
  if (!isRole(input.proposerRole)) return { ok: false, error: "Invalid role." };
  if (typeof input.proposerSignature !== "string" || !isHex(input.proposerSignature)) {
    return { ok: false, error: "Invalid signature." };
  }
  const proposerSignature = input.proposerSignature as Hex;
  const domain = appLedgerDomain();

  const validation = await validateProposal(
    { domain, obligation, document, proposerRole: input.proposerRole, proposerSignature, sessionAddress: session },
    submissionDeps(),
  );
  if (!validation.ok) return { ok: false, error: `${validation.reason}.` };

  const alreadyRecorded = await obligationExistsForDocument({
    chainId: domain.chainId.toString(),
    ledger: domain.verifyingContract,
    debtor: obligation.debtor,
    creditor: obligation.creditor,
    documentHash: obligation.documentHash,
  });
  if (alreadyRecorded) return { ok: false, error: new DuplicateObligationError().message };

  const token = await insertProposal({
    token: newProposalToken(),
    obligationId: obligationId(obligation, domain),
    chainId: domain.chainId.toString(),
    ledger: domain.verifyingContract,
    proposer: session,
    counterparty: partyFor(obligation, counterpartyRole(input.proposerRole)),
    proposerRole: input.proposerRole,
    obligation: serializeObligation(obligation),
    document,
    proposerSignature,
  });
  return { ok: true, token };
}

export type ProposalState = "open" | "accepted" | "withdrawn" | "expired";

export interface ProposalView {
  token: string;
  state: ProposalState;
  viewerRole: "proposer" | "counterparty";
  proposerRole: ProposerRole;
  domain: { chainId: string; verifyingContract: Address };
  obligation: SerializedObligation;
  document: CanonicalObligationDocument;
  proposerSignature: Hex;
  expiresAt: string;
}

function stateOf(status: string, expiresAt: Date, now: Date): ProposalState {
  if (status === "accepted" || status === "withdrawn") return status;
  return expiresAt <= now ? "expired" : "open";
}

/// The proposal behind a token, for one of its two parties only.
export async function getProposal(session: Address, token: unknown): Promise<Result<{ proposal: ProposalView }>> {
  if (!isProposalToken(token)) return { ok: false, error: NOT_FOUND };
  if (await rateLimited("read", session, READ_LIMIT)) return { ok: false, error: "Too many requests. Try again shortly." };

  const row = await getProposalByToken(token);
  if (!row) return { ok: false, error: NOT_FOUND };
  const isProposer = isAddressEqual(session, row.proposer as Address);
  if (!isProposer && !isAddressEqual(session, row.counterparty as Address)) return { ok: false, error: NOT_FOUND };

  const document = toDocument(row.document);
  let obligation;
  try {
    obligation = parseObligationJson(row.obligation);
  } catch {
    obligation = null;
  }
  if (!document || !obligation) return { ok: false, error: "This proposal can't be read." };

  return {
    ok: true,
    proposal: {
      token: row.token,
      state: stateOf(row.status, row.expiresAt, new Date()),
      viewerRole: isProposer ? "proposer" : "counterparty",
      proposerRole: row.proposerRole,
      domain: { chainId: row.chainId, verifyingContract: row.ledger as Address },
      obligation: serializeObligation(obligation),
      document,
      proposerSignature: row.proposerSignature as Hex,
      expiresAt: row.expiresAt.toISOString(),
    },
  };
}

/// The counterparty's signature completes the obligation. The stored proposal is re-validated
/// from scratch, exactly as if it had just been submitted.
export async function acceptProposal(session: Address, token: unknown, signature: unknown): Promise<Result> {
  if (!isProposalToken(token)) return { ok: false, error: NOT_FOUND };
  if (await rateLimited("write", session, WRITE_LIMIT)) return { ok: false, error: "Too many requests. Try again shortly." };
  if (typeof signature !== "string" || !isHex(signature)) return { ok: false, error: "Invalid signature." };

  const row = await getProposalByToken(token);
  if (!row) return { ok: false, error: NOT_FOUND };
  if (!isAddressEqual(session, row.proposer as Address) && !isAddressEqual(session, row.counterparty as Address)) {
    return { ok: false, error: NOT_FOUND };
  }

  const state = stateOf(row.status, row.expiresAt, new Date());
  if (state === "accepted") {
    return (await getObligationById(row.obligationId)) ? { ok: true } : { ok: false, error: "This proposal was already closed." };
  }
  if (state === "withdrawn") return { ok: false, error: "This proposal was withdrawn." };
  if (state === "expired") return { ok: false, error: "This proposal has expired. Ask for a new one." };

  const document = toDocument(row.document);
  let obligation;
  try {
    obligation = parseObligationJson(row.obligation);
  } catch {
    obligation = null;
  }
  if (!document || !obligation) return { ok: false, error: "This proposal can't be read." };

  const domain = { chainId: BigInt(row.chainId), verifyingContract: row.ledger as Address };
  const proposerSignature = row.proposerSignature as Hex;
  const counterpartySignature = signature as Hex;
  const validation = await validateAcceptance(
    {
      domain,
      obligation,
      document,
      proposerRole: row.proposerRole,
      proposerSignature,
      counterpartySignature,
      sessionAddress: session,
    },
    submissionDeps(),
  );
  if (!validation.ok) return { ok: false, error: `${validation.reason}.` };

  const id = obligationId(obligation, domain);
  if (id !== row.obligationId) return { ok: false, error: "This proposal can't be read." };

  try {
    const accepted = await acceptProposalWithObligation(token, {
      obligationId: id,
      chainId: row.chainId,
      ledger: row.ledger,
      documentHash: obligation.documentHash,
      debtor: obligation.debtor,
      creditor: obligation.creditor,
      currency: obligation.currency,
      amount: obligation.amount,
      maturity: obligation.maturity,
      earlyNetConsent: obligation.earlyNetConsent,
      salt: obligation.salt,
      ...signaturesByRole(row.proposerRole, proposerSignature, counterpartySignature),
      description: document.description.trim(),
      blinding: ZERO_HASH,
      createdBy: session,
    });
    if (accepted === "expired") return { ok: false, error: "This proposal has expired. Ask for a new one." };
    if (accepted === "closed") return { ok: false, error: "This proposal was closed. Reload to see its current status." };
  } catch (error) {
    if (error instanceof DuplicateObligationError) return { ok: false, error: error.message };
    throw error;
  }
  return { ok: true };
}

/// Withdraw (proposer) or decline (counterparty) an open proposal. Idempotent.
export async function withdrawProposal(session: Address, token: unknown): Promise<Result> {
  if (!isProposalToken(token)) return { ok: false, error: NOT_FOUND };
  if (await rateLimited("write", session, WRITE_LIMIT)) return { ok: false, error: "Too many requests. Try again shortly." };
  const row = await getProposalByToken(token);
  if (!row) return { ok: false, error: NOT_FOUND };
  if (!isAddressEqual(session, row.proposer as Address) && !isAddressEqual(session, row.counterparty as Address)) {
    return { ok: false, error: NOT_FOUND };
  }
  if (row.status === "accepted") return { ok: false, error: "This proposal was already accepted." };
  const withdrawn = await markProposalWithdrawn(token, session);
  return withdrawn
    ? { ok: true }
    : { ok: false, error: "This proposal just changed. Reload to see its current status." };
}

export interface ProposalSummary {
  token: string;
  waitingOn: "you" | "them";
  youOwe: boolean;
  counterparty: Address;
  currency: string;
  amount: string;
  description: string;
  expiresAt: string;
}

export interface ObligationSummary {
  obligationId: string;
  youOwe: boolean;
  counterparty: Address;
  currency: string;
  amount: string;
  remaining: string;
  maturity: string;
  description: string;
  status: ObligationStatus;
}

export async function listMine(
  session: Address,
): Promise<Result<{ proposals: ProposalSummary[]; obligations: ObligationSummary[] }>> {
  if (await rateLimited("read", session, READ_LIMIT)) return { ok: false, error: "Too many requests. Try again shortly." };
  const me = session.toLowerCase();
  const [proposalRows, obligationRows] = await Promise.all([
    listOpenProposalsForParty(session),
    listObligationsForParty(session),
  ]);

  const proposals: ProposalSummary[] = [];
  for (const row of proposalRows) {
    const document = toDocument(row.document);
    if (!document) continue;
    const isProposer = row.proposer === me;
    proposals.push({
      token: row.token,
      waitingOn: isProposer ? "them" : "you",
      youOwe: document.debtor.toLowerCase() === me,
      counterparty: (isProposer ? row.counterparty : row.proposer) as Address,
      currency: document.currency,
      amount: document.amount,
      description: document.description.trim(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }

  const obligations: ObligationSummary[] = obligationRows.map((row) => ({
    obligationId: row.obligationId,
    youOwe: row.debtor === me,
    counterparty: (row.debtor === me ? row.creditor : row.debtor) as Address,
    currency: row.currency,
    amount: row.amount,
    remaining: row.remaining,
    maturity: row.maturity,
    description: row.description,
    status: row.status,
  }));

  return { ok: true, proposals, obligations };
}
