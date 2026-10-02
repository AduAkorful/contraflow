/// Starter-grant tracking against the `addresses` table.

import { sql, withDbRetry } from "./client";

export type StarterGrantOperation = { status: "reserved" | "submitted" | "unknown" | "confirmed" | "reverted"; txHash: string | null };

export async function getStarterGrantOperation(address: string): Promise<StarterGrantOperation | null> {
  return withDbRetry(async () => {
    const rows = (await sql()`SELECT status, tx_hash FROM starter_grant_operations WHERE address = ${address.toLowerCase()}`) as Record<string, unknown>[];
    const row = rows[0];
    return row ? { status: row.status as StarterGrantOperation["status"], txHash: (row.tx_hash as string | null) ?? null } : null;
  });
}

/// One durable operation per normalized recipient. A reservation is created before broadcast and
/// is never removed after an ambiguous submission, so concurrent/retried requests cannot pay twice.
export async function reserveStarterGrantOperation(address: string): Promise<{ reserved: boolean; operation: StarterGrantOperation }> {
  return withDbRetry(async () => {
    const normalized = address.toLowerCase();
    const inserted = (await sql()`
      INSERT INTO starter_grant_operations (address, status) VALUES (${normalized}, 'reserved')
      ON CONFLICT (address) DO NOTHING RETURNING status, tx_hash
    `) as Record<string, unknown>[];
    if (inserted[0]) return { reserved: true, operation: { status: "reserved", txHash: null } };
    const operation = await getStarterGrantOperation(normalized);
    if (!operation) throw new Error("Starter grant reservation could not be read after conflict.");
    return {
      reserved: false,
      operation,
    };
  });
}

export async function markStarterGrantSubmitted(address: string, txHash: string): Promise<void> {
  await withDbRetry(async () => {
    await sql()`UPDATE starter_grant_operations SET status = 'submitted', tx_hash = ${txHash}, updated_at = now()
                WHERE address = ${address.toLowerCase()} AND status IN ('reserved', 'unknown', 'submitted')`;
  });
}

export async function markStarterGrantUnknown(address: string, txHash?: string): Promise<void> {
  await withDbRetry(async () => {
    await sql()`UPDATE starter_grant_operations SET status = 'unknown', tx_hash = coalesce(${txHash ?? null}, tx_hash), updated_at = now()
                WHERE address = ${address.toLowerCase()} AND status IN ('reserved', 'submitted', 'unknown')`;
  });
}

export async function markStarterGrantReverted(address: string): Promise<void> {
  await withDbRetry(async () => {
    await sql()`UPDATE starter_grant_operations SET status = 'reverted', updated_at = now()
                WHERE address = ${address.toLowerCase()} AND status <> 'confirmed'`;
  });
}

export async function completeStarterGrant(address: string, txHash: string): Promise<void> {
  await withDbRetry(async () => {
    const normalized = address.toLowerCase();
    const db = sql();
    await db.transaction([
      db`UPDATE starter_grant_operations SET status = 'confirmed', tx_hash = ${txHash}, updated_at = now()
         WHERE address = ${normalized} AND status IN ('reserved', 'submitted', 'unknown', 'confirmed')`,
      db`INSERT INTO addresses (address, starter_grant_tx_hash, starter_granted_at)
         VALUES (${normalized}, ${txHash}, now())
         ON CONFLICT (address) DO UPDATE SET starter_grant_tx_hash = EXCLUDED.starter_grant_tx_hash,
           starter_granted_at = coalesce(addresses.starter_granted_at, EXCLUDED.starter_granted_at)`,
    ]);
  });
}

export async function releaseUnsubmittedStarterGrant(address: string): Promise<void> {
  await withDbRetry(async () => {
    await sql()`DELETE FROM starter_grant_operations WHERE address = ${address.toLowerCase()} AND status = 'reserved' AND tx_hash IS NULL`;
  });
}

export async function hasReceivedStarterGrant(address: string): Promise<boolean> {
  return withDbRetry(async () => {
    const db = sql();
    const rows = await db`SELECT 1 FROM addresses WHERE address = ${address} AND starter_grant_tx_hash IS NOT NULL`;
    return (rows as unknown[]).length > 0;
  });
}

export async function recordStarterGrant(address: string, txHash: string): Promise<void> {
  await withDbRetry(async () => {
    const db = sql();
    await db`
      INSERT INTO addresses (address, starter_grant_tx_hash, starter_granted_at)
      VALUES (${address}, ${txHash}, now())
      ON CONFLICT (address) DO UPDATE SET
        starter_grant_tx_hash = EXCLUDED.starter_grant_tx_hash,
        starter_granted_at = EXCLUDED.starter_granted_at
    `;
  });
}
