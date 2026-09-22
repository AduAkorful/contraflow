/// Starter-grant tracking against the `addresses` table.

import { sql, withDbRetry } from "./client";

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
