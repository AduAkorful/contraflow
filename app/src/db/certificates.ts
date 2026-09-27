/// Neon implementation of `CertificateStore` (`netting_certificates`, `_entries`, `_signatures`).
/// A plain data-access layer: who may call what is decided in `src/obligations/certificates.ts`.
///
/// Concurrency rests on two things. The partial unique index `netting_certificate_entries_lock`
/// stops an obligation entering two open certificates. And every transaction that can race on
/// the same row takes a row lock first (`FOR UPDATE`), so the statements after it see what the
/// other transaction committed.

import type {
  AppliedEntryUpdate,
  CertificateRow,
  CertificateStore,
  InsertCertificateResult,
  NewCertificate,
} from "../obligations/certificateStore";
import { sql, withDbRetry } from "./client";
import { toObligationRow, type ObligationRow } from "./obligations";

const LOCK_INDEX = "netting_certificate_entries_lock";
const UNIQUE_VIOLATION = "23505";
// Raised on purpose by the guard statement in insertCertificate.
const DIVISION_BY_ZERO = "22012";

function toCertificateRow(r: Record<string, unknown>): CertificateRow {
  const entries = (r.entries as Record<string, unknown>[]) ?? [];
  const signatures = (r.signatures as Record<string, unknown>[]) ?? [];
  return {
    certificateId: r.certificate_id as string,
    token: r.token as string,
    chainId: r.chain_id as string,
    ledger: r.ledger as string,
    currency: r.currency as string,
    wNet: r.w_net as string,
    deadline: r.deadline as string,
    contentHash: r.content_hash as string,
    fullView: r.full_view,
    proposedBy: r.proposed_by as string,
    status: r.status as CertificateRow["status"],
    appliedTxHash: (r.applied_tx_hash as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    closedAt: r.closed_at ? new Date(r.closed_at as string) : null,
    closedReason: (r.closed_reason as string | null) ?? null,
    entries: entries.map((e) => ({
      idx: Number(e.idx),
      obligationId: e.obligationId as string,
      debtor: e.debtor as string,
      creditor: e.creditor as string,
      locked: e.locked as boolean,
    })),
    signatures: signatures.map((s) => ({ idx: Number(s.idx), signer: s.signer as string, signature: s.signature as string })),
  };
}

function withChildren(where: "token" | "id" | "party", value: string) {
  const db = sql();
  const children = `
    (SELECT coalesce(json_agg(json_build_object('idx', e.idx, 'obligationId', e.obligation_id, 'debtor', e.debtor,
       'creditor', e.creditor, 'locked', e.locked) ORDER BY e.idx), '[]'::json)
     FROM netting_certificate_entries e WHERE e.certificate_id = c.certificate_id) AS entries,
    (SELECT coalesce(json_agg(json_build_object('idx', s.idx, 'signer', s.signer, 'signature', s.signature)
       ORDER BY s.idx), '[]'::json)
     FROM netting_certificate_signatures s WHERE s.certificate_id = c.certificate_id) AS signatures`;
  if (where === "token") return db.query(`SELECT c.*, ${children} FROM netting_certificates c WHERE c.token = $1`, [value]);
  if (where === "id") {
    return db.query(`SELECT c.*, ${children} FROM netting_certificates c WHERE c.certificate_id = $1`, [value]);
  }
  return db.query(
    `SELECT c.*, ${children} FROM netting_certificates c
     WHERE EXISTS (SELECT 1 FROM netting_certificate_entries e
                   WHERE e.certificate_id = c.certificate_id AND (e.debtor = $1 OR e.creditor = $1))
     ORDER BY c.created_at DESC LIMIT 100`,
    [value],
  );
}

/// Releases the locks of a certificate that is no longer open. Safe to run any number of times.
function releaseLocks(certificateId: string) {
  return sql()`
    UPDATE netting_certificate_entries e SET locked = false
    FROM netting_certificates c
    WHERE e.certificate_id = c.certificate_id AND c.certificate_id = ${certificateId}
      AND e.locked AND c.status NOT IN ('collecting', 'ready')
  `;
}

function dbErrorCode(error: unknown): { code?: string; constraint?: string } {
  return (error ?? {}) as { code?: string; constraint?: string };
}

export const neonCertificateStore: CertificateStore = {
  async listNettableObligations({ chainId, ledger, limit }): Promise<ObligationRow[]> {
    return withDbRetry(async () => {
      const rows = (await sql()`
        SELECT o.* FROM netting_obligations o
        WHERE o.chain_id = ${chainId} AND o.ledger = ${ledger.toLowerCase()} AND o.status = 'active'
          AND o.remaining <> '0'
          AND NOT EXISTS (SELECT 1 FROM netting_certificate_entries e WHERE e.obligation_id = o.obligation_id AND e.locked)
        ORDER BY o.created_at ASC LIMIT ${limit}
      `) as Record<string, unknown>[];
      return rows.map(toObligationRow);
    });
  },

  async getObligationById(obligationId) {
    return withDbRetry(async () => {
      const rows = (await sql()`
        SELECT * FROM netting_obligations WHERE obligation_id = ${obligationId.toLowerCase()}
      `) as Record<string, unknown>[];
      return rows[0] ? toObligationRow(rows[0]) : null;
    });
  },

  async markObligationOutOfSync(obligationId, expected) {
    await withDbRetry(async () => {
      await sql()`
        UPDATE netting_obligations SET status = 'out_of_sync'
        WHERE obligation_id = ${obligationId.toLowerCase()} AND status = 'active'
          AND remaining = ${expected.remaining} AND blinding = ${expected.blinding.toLowerCase()}
      `;
    });
  },

  async insertCertificate(input: NewCertificate): Promise<InsertCertificateResult> {
    const ids = input.entries.map((e) => e.obligationId.toLowerCase());
    const remainings = input.entries.map((e) => e.remaining);
    const blindings = input.entries.map((e) => e.blinding.toLowerCase());
    try {
      await withDbRetry(async () => {
        const db = sql();
        await db.transaction([
          db`SELECT obligation_id FROM netting_obligations WHERE obligation_id = ANY(${ids}::text[])
             ORDER BY obligation_id FOR UPDATE`,
          // Fails the whole transaction (division by zero) unless every obligation is still
          // active and in exactly the state the certificate was built from.
          db`SELECT 1 / (CASE WHEN (
               SELECT count(*) FROM netting_obligations o
               JOIN unnest(${ids}::text[], ${remainings}::text[], ${blindings}::text[]) AS x(id, remaining, blinding)
                 ON o.obligation_id = x.id AND o.remaining = x.remaining AND o.blinding = x.blinding
               WHERE o.status = 'active') = ${ids.length} THEN 1 ELSE 0 END)`,
          db`
            INSERT INTO netting_certificates (certificate_id, token, chain_id, ledger, currency, w_net, deadline,
              content_hash, full_view, proposed_by)
            VALUES (${input.certificateId.toLowerCase()}, ${input.token}, ${input.chainId}, ${input.ledger.toLowerCase()},
              ${input.currency}, ${input.wNet}, ${input.deadline}, ${input.contentHash.toLowerCase()},
              ${JSON.stringify(input.fullView)}::jsonb, ${input.proposedBy.toLowerCase()})
          `,
          ...input.entries.map(
            (e, idx) => db`
              INSERT INTO netting_certificate_entries (certificate_id, idx, obligation_id, debtor, creditor)
              VALUES (${input.certificateId.toLowerCase()}, ${idx}, ${e.obligationId.toLowerCase()},
                ${e.debtor.toLowerCase()}, ${e.creditor.toLowerCase()})
            `,
          ),
        ]);
      });
    } catch (error) {
      const { code, constraint } = dbErrorCode(error);
      if (code === UNIQUE_VIOLATION && constraint === LOCK_INDEX) return "locked";
      if (code === DIVISION_BY_ZERO) return "changed";
      throw error;
    }
    return "inserted";
  },

  async getCertificateByToken(token) {
    return withDbRetry(async () => {
      const rows = (await withChildren("token", token)) as Record<string, unknown>[];
      return rows[0] ? toCertificateRow(rows[0]) : null;
    });
  },

  async getCertificateById(certificateId) {
    return withDbRetry(async () => {
      const rows = (await withChildren("id", certificateId.toLowerCase())) as Record<string, unknown>[];
      return rows[0] ? toCertificateRow(rows[0]) : null;
    });
  },

  async listCertificatesForParty(address) {
    return withDbRetry(async () => {
      const rows = (await withChildren("party", address.toLowerCase())) as Record<string, unknown>[];
      return rows.map(toCertificateRow);
    });
  },

  async addSignature({ certificateId, idx, signer, signature, required }) {
    const id = certificateId.toLowerCase();
    await withDbRetry(async () => {
      const db = sql();
      await db.transaction([
        // Serializes concurrent signatures, so the last one always sees every other and flips
        // the status.
        db`SELECT certificate_id FROM netting_certificates WHERE certificate_id = ${id} FOR UPDATE`,
        db`
          INSERT INTO netting_certificate_signatures (certificate_id, idx, signer, signature)
          SELECT ${id}, ${idx}, ${signer.toLowerCase()}, ${signature.toLowerCase()}
          WHERE EXISTS (SELECT 1 FROM netting_certificates WHERE certificate_id = ${id} AND status = 'collecting')
          ON CONFLICT (certificate_id, idx) DO NOTHING
        `,
        db`
          UPDATE netting_certificates SET status = 'ready'
          WHERE certificate_id = ${id} AND status = 'collecting'
            AND (SELECT count(*) FROM netting_certificate_signatures WHERE certificate_id = ${id}) = ${required}
        `,
      ]);
    });
  },

  async abandonCertificate(certificateId, reason) {
    const id = certificateId.toLowerCase();
    return withDbRetry(async () => {
      const db = sql();
      const [abandoned] = (await db.transaction([
        db`
          UPDATE netting_certificates SET status = 'abandoned', closed_at = now(), closed_reason = ${reason}
          WHERE certificate_id = ${id} AND status = 'collecting'
          RETURNING certificate_id
        `,
        releaseLocks(id),
      ])) as unknown[][];
      return (abandoned?.length ?? 0) > 0;
    });
  },

  async expireCertificate(certificateId) {
    const id = certificateId.toLowerCase();
    await withDbRetry(async () => {
      const db = sql();
      await db.transaction([
        db`
          UPDATE netting_certificates SET status = 'expired', closed_at = now(), closed_reason = 'deadline passed'
          WHERE certificate_id = ${id} AND status IN ('collecting', 'ready')
        `,
        releaseLocks(id),
      ]);
    });
  },

  async finalizeApplied({ certificateId, txHash, entries }) {
    const id = certificateId.toLowerCase();
    await withDbRetry(async () => {
      const db = sql();
      await db.transaction([
        ...entries.map((e: AppliedEntryUpdate) =>
          e.movedOn
            ? db`
                UPDATE netting_obligations SET status = 'out_of_sync'
                WHERE obligation_id = ${e.obligationId.toLowerCase()} AND status <> 'out_of_sync'
                  AND remaining = ${e.before.remaining} AND blinding = ${e.before.blinding.toLowerCase()}
              `
            : db`
                UPDATE netting_obligations SET remaining = ${e.after.remaining}, blinding = ${e.after.blinding.toLowerCase()}
                WHERE obligation_id = ${e.obligationId.toLowerCase()} AND status <> 'out_of_sync'
                  AND remaining = ${e.before.remaining} AND blinding = ${e.before.blinding.toLowerCase()}
              `,
        ),
        db`
          UPDATE netting_certificates
          SET status = 'applied', closed_at = now(), applied_tx_hash = coalesce(applied_tx_hash, ${txHash?.toLowerCase() ?? null})
          WHERE certificate_id = ${id} AND status IN ('collecting', 'ready')
        `,
        releaseLocks(id),
      ]);
    });
  },

  async setAppliedTxHash(certificateId, txHash) {
    await withDbRetry(async () => {
      await sql()`
        UPDATE netting_certificates SET applied_tx_hash = ${txHash.toLowerCase()}
        WHERE certificate_id = ${certificateId.toLowerCase()} AND applied_tx_hash IS NULL
      `;
    });
  },

  async closeObligation(obligationId, by) {
    const id = obligationId.toLowerCase();
    return withDbRetry(async () => {
      const db = sql();
      const results = (await db.transaction([
        // Serializes against a certificate being proposed over this obligation.
        db`SELECT obligation_id FROM netting_obligations WHERE obligation_id = ${id} FOR UPDATE`,
        db`
          UPDATE netting_certificates SET status = 'abandoned', closed_at = now(), closed_reason = 'obligation closed'
          WHERE status = 'collecting' AND certificate_id IN (
            SELECT certificate_id FROM netting_certificate_entries WHERE obligation_id = ${id} AND locked)
        `,
        db`
          UPDATE netting_certificate_entries e SET locked = false
          FROM netting_certificates c
          WHERE e.certificate_id = c.certificate_id AND e.locked AND c.status NOT IN ('collecting', 'ready')
            AND c.certificate_id IN (SELECT certificate_id FROM netting_certificate_entries WHERE obligation_id = ${id})
        `,
        db`
          UPDATE netting_obligations SET status = 'closed', closed_by = ${by.toLowerCase()}, closed_at = now()
          WHERE obligation_id = ${id} AND status IN ('active', 'out_of_sync')
            AND NOT EXISTS (SELECT 1 FROM netting_certificate_entries WHERE obligation_id = ${id} AND locked)
        `,
        db`SELECT status FROM netting_obligations WHERE obligation_id = ${id}`,
      ])) as Record<string, unknown>[][];
      const status = results[results.length - 1]?.[0]?.status;
      return status === "closed" ? "closed" : "blocked";
    });
  },
};
