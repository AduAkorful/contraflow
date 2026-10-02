/// What the certificate service needs from storage. `src/db/certificates.ts` implements it on
/// Neon; the tests implement it in memory with the same semantics. Addresses and hex are
/// lowercase in and out.

import type { ObligationRow } from "../db/obligations";

export type CertificateStatus = "collecting" | "ready" | "applied" | "expired" | "abandoned";

/// Still able to change the obligations in it, so its obligations stay locked.
export const OPEN_CERTIFICATE_STATUSES: readonly CertificateStatus[] = ["collecting", "ready"];

export interface CertificateEntryRow {
  idx: number;
  obligationId: string;
  debtor: string;
  creditor: string;
  locked: boolean;
}

export interface CertificateSignatureRow {
  idx: number;
  signer: string;
  signature: string;
}

export interface CertificateRow {
  certificateId: string;
  token: string;
  chainId: string;
  ledger: string;
  currency: string;
  wNet: string;
  /// Unix seconds.
  deadline: string;
  contentHash: string;
  /// `serializeCertificateView`'s JSON for the full view, unsigned. Server-only.
  fullView: unknown;
  proposedBy: string;
  status: CertificateStatus;
  appliedTxHash: string | null;
  createdAt: Date;
  closedAt: Date | null;
  closedReason: string | null;
  entries: CertificateEntryRow[];
  signatures: CertificateSignatureRow[];
}

export interface NewCertificate {
  certificateId: string;
  token: string;
  chainId: string;
  ledger: string;
  currency: string;
  wNet: string;
  deadline: string;
  contentHash: string;
  fullView: unknown;
  proposedBy: string;
  entries: {
    obligationId: string;
    debtor: string;
    creditor: string;
    /// The state the certificate was built from. The insert fails unless the obligation is
    /// still active and still in exactly this state.
    remaining: string;
    blinding: string;
  }[];
}

/// `locked`: an obligation was taken by another open certificate first. `changed`: an
/// obligation's status or state changed since it was read.
export type InsertCertificateResult = "inserted" | "locked" | "changed";
export type AddSignatureResult = "stored" | "already_present" | "closed" | "expired" | "missing";

export interface AppliedEntryUpdate {
  obligationId: string;
  before: { remaining: string; blinding: string };
  after: { remaining: string; blinding: string };
  /// The ledger has already moved past this certificate's next state, by a certificate the
  /// database never saw. The obligation is marked out of sync instead of advanced.
  movedOn: boolean;
}

export interface CertificateStore {
  /// Active obligations on this ledger with something left to net and no open certificate.
  /// Returns at most `limit` rows.
  listNettableObligations(params: { chainId: string; ledger: string; limit: number }): Promise<ObligationRow[]>;
  getObligationById(obligationId: string): Promise<ObligationRow | null>;
  /// Only from `active`, and only while the stored state is still `expected`.
  markObligationOutOfSync(obligationId: string, expected: { remaining: string; blinding: string }): Promise<void>;
  insertCertificate(input: NewCertificate): Promise<InsertCertificateResult>;
  getCertificateByToken(token: string): Promise<CertificateRow | null>;
  getCertificateById(certificateId: string): Promise<CertificateRow | null>;
  listCertificatesForParty(address: string): Promise<CertificateRow[]>;
  /// Stores the signature only while the certificate is collecting (idempotent per index), and
  /// moves it to `ready` in the same transaction once `required` signatures are in.
  addSignature(params: { certificateId: string; idx: number; signer: string; signature: string; required: number }): Promise<AddSignatureResult>;
  /// `collecting` → `abandoned`, releasing its locks. Returns whether it was abandoned.
  abandonCertificate(certificateId: string, reason: string): Promise<boolean>;
  /// `collecting`/`ready` → `expired`, releasing its locks.
  expireCertificate(certificateId: string): Promise<void>;
  /// `collecting`/`ready` → `applied` with its obligations advanced (each only from its stored
  /// before-state) and its locks released, in one transaction.
  finalizeApplied(params: { certificateId: string; txHash: string | null; entries: AppliedEntryUpdate[] }): Promise<void>;
  setAppliedTxHash(certificateId: string, txHash: string): Promise<void>;
  /// Closes an obligation, abandoning any collecting certificate it's in. Refused (`blocked`)
  /// while it's in a fully signed one.
  closeObligation(obligationId: string, by: string): Promise<"closed" | "blocked">;
}
