/// An in-memory `CertificateStore` with the semantics the SQL in `src/db/certificates.ts` has:
/// the partial unique lock index, the "still in this state" guard on insert, signatures only
/// while collecting, and every closing status releasing its locks. Each method is atomic, like
/// the transaction it stands in for.

import type { Hex } from "viem";
import { ZERO_HASH } from "../../src/netting/commitment";
import { obligationId } from "../../src/netting/obligation";
import type { LedgerDomain } from "../../src/netting/types";
import type { ObligationRow } from "../../src/db/obligations";
import type { LoopObligation } from "../../src/netting/certificate";
import type {
  CertificateRow,
  CertificateStore,
  InsertCertificateResult,
  NewCertificate,
} from "../../src/obligations/certificateStore";

export interface MemoryCertificateStore extends CertificateStore {
  obligations: Map<string, ObligationRow>;
  certificates: Map<string, CertificateRow>;
  /// Throws a transient-looking error from the next write.
  failNextWrite: () => void;
}

const OPEN = ["collecting", "ready"];

export function createMemoryCertificateStore(): MemoryCertificateStore {
  const obligations = new Map<string, ObligationRow>();
  const certificates = new Map<string, CertificateRow>();
  let failWrite = false;

  const clone = <T>(value: T): T => structuredClone(value);
  const write = () => {
    if (failWrite) {
      failWrite = false;
      throw new Error("Error connecting to database: fetch failed");
    }
  };
  const isLocked = (id: string) =>
    [...certificates.values()].some((c) => c.entries.some((e) => e.obligationId === id && e.locked));
  const release = (c: CertificateRow) => {
    if (!OPEN.includes(c.status)) for (const e of c.entries) e.locked = false;
  };

  return {
    obligations,
    certificates,
    failNextWrite: () => {
      failWrite = true;
    },

    async listNettableObligations({ chainId, ledger, limit }) {
      return [...obligations.values()]
        .filter((o) => o.chainId === chainId && o.ledger === ledger.toLowerCase())
        .filter((o) => o.status === "active" && o.remaining !== "0" && !isLocked(o.obligationId))
        .slice(0, limit)
        .map(clone);
    },

    async getObligationById(id) {
      const row = obligations.get(id.toLowerCase());
      return row ? clone(row) : null;
    },

    async markObligationOutOfSync(id, expected) {
      write();
      const row = obligations.get(id.toLowerCase());
      if (row?.status === "active" && row.remaining === expected.remaining && row.blinding === expected.blinding.toLowerCase()) {
        row.status = "out_of_sync";
      }
    },

    async insertCertificate(input: NewCertificate): Promise<InsertCertificateResult> {
      write();
      const unchanged = input.entries.every((e) => {
        const row = obligations.get(e.obligationId.toLowerCase());
        return row?.status === "active" && row.remaining === e.remaining && row.blinding === e.blinding.toLowerCase();
      });
      if (!unchanged) return "changed";
      if (input.entries.some((e) => isLocked(e.obligationId.toLowerCase()))) return "locked";
      const id = input.certificateId.toLowerCase();
      certificates.set(id, {
        certificateId: id,
        token: input.token,
        chainId: input.chainId,
        ledger: input.ledger.toLowerCase(),
        currency: input.currency,
        wNet: input.wNet,
        deadline: input.deadline,
        contentHash: input.contentHash.toLowerCase(),
        fullView: clone(input.fullView),
        proposedBy: input.proposedBy.toLowerCase(),
        status: "collecting",
        appliedTxHash: null,
        createdAt: new Date(),
        closedAt: null,
        closedReason: null,
        entries: input.entries.map((e, idx) => ({
          idx,
          obligationId: e.obligationId.toLowerCase(),
          debtor: e.debtor.toLowerCase(),
          creditor: e.creditor.toLowerCase(),
          locked: true,
        })),
        signatures: [],
      });
      return "inserted";
    },

    async getCertificateByToken(token) {
      const row = [...certificates.values()].find((c) => c.token === token);
      return row ? clone(row) : null;
    },

    async getCertificateById(id) {
      const row = certificates.get(id.toLowerCase());
      return row ? clone(row) : null;
    },

    async listCertificatesForParty(address) {
      const a = address.toLowerCase();
      return [...certificates.values()]
        .filter((c) => c.entries.some((e) => e.debtor === a || e.creditor === a))
        .reverse()
        .map(clone);
    },

    async addSignature({ certificateId, idx, signer, signature, required }) {
      write();
      const c = certificates.get(certificateId.toLowerCase());
      if (!c) return "missing";
      if (BigInt(c.deadline) < BigInt(Math.floor(Date.now() / 1000))) return "expired";
      if (c.status !== "collecting") return "closed";
      if (c.signatures.some((s) => s.idx === idx)) return "already_present";
      c.signatures.push({ idx, signer: signer.toLowerCase(), signature: signature.toLowerCase() });
      c.signatures.sort((a, b) => a.idx - b.idx);
      if (c.signatures.length === required) c.status = "ready";
      return "stored";
    },

    async abandonCertificate(certificateId, reason) {
      write();
      const c = certificates.get(certificateId.toLowerCase());
      if (!c || c.status !== "collecting") return false;
      c.status = "abandoned";
      c.closedReason = reason;
      c.closedAt = new Date();
      release(c);
      return true;
    },

    async expireCertificate(certificateId) {
      write();
      const c = certificates.get(certificateId.toLowerCase());
      if (!c || !OPEN.includes(c.status)) return;
      c.status = "expired";
      c.closedReason = "deadline passed";
      c.closedAt = new Date();
      release(c);
    },

    async finalizeApplied({ certificateId, txHash, entries }) {
      write();
      for (const e of entries) {
        const row = obligations.get(e.obligationId.toLowerCase());
        if (!row || row.status === "out_of_sync") continue;
        if (row.remaining !== e.before.remaining || row.blinding !== e.before.blinding.toLowerCase()) continue;
        if (e.movedOn) {
          row.status = "out_of_sync";
        } else {
          row.remaining = e.after.remaining;
          row.blinding = e.after.blinding.toLowerCase();
        }
      }
      const c = certificates.get(certificateId.toLowerCase());
      if (c && OPEN.includes(c.status)) {
        c.status = "applied";
        c.appliedTxHash ??= txHash?.toLowerCase() ?? null;
        c.closedAt = new Date();
      }
      if (c) release(c);
    },

    async setAppliedTxHash(certificateId, txHash) {
      write();
      const c = certificates.get(certificateId.toLowerCase());
      if (c && c.appliedTxHash === null) c.appliedTxHash = txHash.toLowerCase();
    },

    async closeObligation(id) {
      write();
      const key = id.toLowerCase();
      for (const c of certificates.values()) {
        if (c.status === "collecting" && c.entries.some((e) => e.obligationId === key && e.locked)) {
          c.status = "abandoned";
          c.closedReason = "obligation closed";
          release(c);
        }
      }
      const row = obligations.get(key);
      if (row && (row.status === "active" || row.status === "out_of_sync") && !isLocked(key)) {
        row.status = "closed";
      }
      return row?.status === "closed" ? "closed" : "blocked";
    },
  };
}

/// Stores a fully signed obligation as step 3 would have, in its never-netted state.
export function seedObligation(store: MemoryCertificateStore, domain: LedgerDomain, item: LoopObligation): ObligationRow {
  const o = item.obligation;
  const row: ObligationRow = {
    obligationId: obligationId(o, domain),
    chainId: domain.chainId.toString(),
    ledger: domain.verifyingContract.toLowerCase(),
    documentHash: o.documentHash.toLowerCase(),
    debtor: o.debtor.toLowerCase(),
    creditor: o.creditor.toLowerCase(),
    currency: o.currency,
    amount: o.amount.toString(),
    maturity: o.maturity.toString(),
    earlyNetConsent: o.earlyNetConsent,
    salt: o.salt.toLowerCase(),
    debtorSignature: item.debtorSignature.toLowerCase(),
    creditorSignature: item.creditorSignature.toLowerCase(),
    description: "Test obligation",
    remaining: item.remaining.toString(),
    blinding: (item.blinding ?? (ZERO_HASH as Hex)).toLowerCase(),
    status: "active",
    createdBy: o.creditor.toLowerCase(),
    createdAt: new Date(),
  };
  store.obligations.set(row.obligationId, row);
  return row;
}
