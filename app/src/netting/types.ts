/// Shapes shared by the Mode B netting module. Every integer is a `bigint`, never a `number`:
/// amounts are minor units of a fiat currency with no upper bound, and viem's typed-data hashing
/// needs an exact bigint for `uintN` fields.

import type { Address, Hex } from "viem";

/// Which ledger deployment a signature is bound to (the EIP-712 domain's variable half).
export interface LedgerDomain {
  chainId: bigint;
  verifyingContract: Address;
}

/// Mirrors `NettingObligation` in `IContraflowNettingLedger.sol`, field for field.
export interface NettingObligation {
  documentHash: Hex;
  debtor: Address;
  creditor: Address;
  /// ISO 4217 code, e.g. "USD". `amount` is in that currency's minor units.
  currency: string;
  amount: bigint;
  /// uint64 unix seconds.
  maturity: bigint;
  earlyNetConsent: boolean;
  salt: Hex;
}

/// Mirrors `CertificateEntry`: the only part of an obligation the ledger ever sees.
export interface CertificateEntry {
  obligationId: Hex;
  debtor: Address;
  creditor: Address;
  priorCommitment: Hex;
  nextCommitment: Hex;
}

/// Mirrors `NettingCertificate`.
export interface NettingCertificate {
  certificateId: Hex;
  contentHash: Hex;
  /// uint64 unix seconds.
  deadline: bigint;
  entries: CertificateEntry[];
}

/// Everything behind one certificate entry. Only the obligation's own two parties ever hold
/// this in full; everyone else in the loop sees just its `entryHash`.
export interface EntryDocument {
  obligation: NettingObligation;
  /// Both parties' EIP-712 signatures over the obligation.
  debtorSignature: Hex;
  creditorSignature: Hex;
  remainingBefore: bigint;
  /// The zero hash when the obligation has never been netted (its onchain state is empty).
  blindingBefore: Hex;
  remainingAfter: bigint;
  blindingAfter: Hex;
}

export type ViewEntry = { kind: "full"; document: EntryDocument } | { kind: "hash"; entryHash: Hex };

/// A certificate as one reader holds it. `entries` lines up index for index with
/// `certificate.entries`. A party's own view has its two entries in full and the rest as hashes;
/// a full view (the proposer's, or an auditor's) has every entry in full.
export interface CertificateView {
  domain: LedgerDomain;
  currency: string;
  wNet: bigint;
  certificate: NettingCertificate;
  /// One per entry, from that entry's debtor, over `certificateDigest`. `null` until signed.
  signatures: (Hex | null)[];
  entries: ViewEntry[];
}
