/// Server-side validation for Mode B obligation proposals and acceptances. Everything is
/// re-derived here: nothing a browser sends, and nothing read back from the database, is trusted
/// until it passes. Dependencies are injected so the checks are unit-testable without a chain or
/// a compliance vendor.

import { isAddressEqual, isHex, size, type Address, type Hex } from "viem";
import { screenAddresses, type ComplianceProvider } from "../compliance";
import { isZeroHash } from "../netting/commitment";
import { appLedgerDomain } from "../netting/domain";
import { obligationDocumentProblem, obligationMatchesDocument, type CanonicalObligationDocument } from "../netting/document";
import { obligationId } from "../netting/obligation";
import { checkSignature, type ChainReader } from "../netting/signature";
import type { LedgerDomain, NettingObligation } from "../netting/types";

export type ProposerRole = "debtor" | "creditor";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export interface SubmissionDeps {
  /// A client for the ledger's chain, so a smart-account signature can be checked. Offline
  /// "unverifiable" is never accepted here.
  client: ChainReader;
  complianceProvider: ComplianceProvider;
}

export interface ProposalInput {
  domain: LedgerDomain;
  obligation: NettingObligation;
  document: CanonicalObligationDocument;
  proposerRole: ProposerRole;
  proposerSignature: Hex;
}

const MAX_UINT64 = 2n ** 64n - 1n;
const MAX_UINT256 = 2n ** 256n - 1n;

export function counterpartyRole(role: ProposerRole): ProposerRole {
  return role === "debtor" ? "creditor" : "debtor";
}

export function partyFor(obligation: NettingObligation, role: ProposerRole): Address {
  return role === "debtor" ? obligation.debtor : obligation.creditor;
}

/// The terms on their own: the right ledger, a well-formed obligation, and a document that says
/// exactly what the obligation says.
export function obligationTermsProblem(input: Pick<ProposalInput, "domain" | "obligation" | "document">): string | null {
  const expected = appLedgerDomain();
  const { domain, obligation, document } = input;
  if (domain.chainId !== expected.chainId || !isAddressEqual(domain.verifyingContract, expected.verifyingContract)) {
    return "This obligation is for a different ledger";
  }
  const documentProblem = obligationDocumentProblem(document);
  if (documentProblem) return documentProblem;
  if (!isHex(obligation.salt) || size(obligation.salt) !== 32 || isZeroHash(obligation.salt)) return "Invalid salt";
  if (obligation.amount <= 0n || obligation.amount > MAX_UINT256) return "Invalid amount";
  if (obligation.maturity < 0n || obligation.maturity > MAX_UINT64) return "Invalid maturity";
  if (!obligationMatchesDocument(obligation, document)) return "The obligation doesn't match its document";
  return null;
}

async function signatureProblem(
  signer: Address,
  obligation: NettingObligation,
  domain: LedgerDomain,
  signature: Hex,
  client: ChainReader,
): Promise<string | null> {
  if (!isHex(signature)) return `Invalid signature from ${signer}`;
  const result = await checkSignature(signer, obligationId(obligation, domain), signature, client);
  return result.status === "pass" ? null : `Invalid signature from ${signer}`;
}

async function complianceProblem(obligation: NettingObligation, provider: ComplianceProvider): Promise<string | null> {
  const results = await screenAddresses([obligation.debtor, obligation.creditor], provider);
  return results.some((r) => r.status !== "clear") ? "Blocked by compliance screening" : null;
}

/// A proposer submitting a signed proposal.
export async function validateProposal(
  input: ProposalInput & { sessionAddress: Address },
  deps: SubmissionDeps,
): Promise<ValidationResult> {
  const terms = obligationTermsProblem(input);
  if (terms) return { ok: false, reason: terms };
  if (!isAddressEqual(input.sessionAddress, partyFor(input.obligation, input.proposerRole))) {
    return { ok: false, reason: "You can only propose an obligation you're a party to" };
  }
  const signature = await signatureProblem(
    partyFor(input.obligation, input.proposerRole),
    input.obligation,
    input.domain,
    input.proposerSignature,
    deps.client,
  );
  if (signature) return { ok: false, reason: signature };
  const compliance = await complianceProblem(input.obligation, deps.complianceProvider);
  if (compliance) return { ok: false, reason: compliance };
  return { ok: true };
}

/// The counterparty accepting a stored proposal: the stored proposal is re-validated in full,
/// as if it had just arrived.
export async function validateAcceptance(
  input: ProposalInput & { sessionAddress: Address; counterpartySignature: Hex },
  deps: SubmissionDeps,
): Promise<ValidationResult> {
  const terms = obligationTermsProblem(input);
  if (terms) return { ok: false, reason: terms };
  const counterparty = partyFor(input.obligation, counterpartyRole(input.proposerRole));
  if (!isAddressEqual(input.sessionAddress, counterparty)) {
    return { ok: false, reason: "Only the counterparty can accept this obligation" };
  }
  for (const [signer, signature] of [
    [partyFor(input.obligation, input.proposerRole), input.proposerSignature],
    [counterparty, input.counterpartySignature],
  ] as const) {
    const problem = await signatureProblem(signer, input.obligation, input.domain, signature, deps.client);
    if (problem) return { ok: false, reason: problem };
  }
  const compliance = await complianceProblem(input.obligation, deps.complianceProvider);
  if (compliance) return { ok: false, reason: compliance };
  return { ok: true };
}

/// Debtor and creditor signatures in ledger order, from a proposal and its acceptance.
export function signaturesByRole(proposerRole: ProposerRole, proposerSignature: Hex, counterpartySignature: Hex) {
  return proposerRole === "debtor"
    ? { debtorSignature: proposerSignature, creditorSignature: counterpartySignature }
    : { debtorSignature: counterpartySignature, creditorSignature: proposerSignature };
}

