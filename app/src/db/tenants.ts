/// Neon implementation of the API's `TenantStore`. Access control lives in `src/api/auth.ts`;
/// this is data access only. Addresses and hex are stored lowercase.

import { getAddress, type Address, type Hex } from "viem";
import type { NewPermission, StoredKey, StoredPermission, TenantStore } from "../api/auth";
import { sql, withDbRetry } from "./client";

interface PermissionDbRow {
  permission_id: string;
  tenant_id: string;
  chain_id: string;
  party: string;
  scopes: number;
  expires_at: string;
  revoked_at: string | null;
}

function toPermission(row: PermissionDbRow): StoredPermission {
  return {
    permissionId: row.permission_id,
    tenantId: row.tenant_id as Hex,
    chainId: Number(row.chain_id),
    party: getAddress(row.party),
    scopes: row.scopes,
    expiresAt: BigInt(row.expires_at),
    revoked: row.revoked_at !== null,
  };
}

export const neonTenantStore: TenantStore = {
  async findKey(hash) {
    const rows = (await withDbRetry(
      () => sql()`SELECT k.tenant_id, k.mode, k.revoked_at, t.status
                  FROM tenant_api_keys k JOIN tenants t ON t.tenant_id = k.tenant_id
                  WHERE k.key_hash = ${hash}`,
    )) as { tenant_id: string; mode: "test" | "live"; revoked_at: string | null; status: string }[];
    const row = rows[0];
    if (!row) return null;
    return {
      tenantId: row.tenant_id as Hex,
      mode: row.mode,
      revoked: row.revoked_at !== null,
      tenantActive: row.status === "active",
    } satisfies StoredKey;
  },

  async savePermission(p: NewPermission) {
    const rows = (await withDbRetry(
      () => sql()`INSERT INTO tenant_permissions
                    (permission_id, tenant_id, chain_id, party, scopes, expires_at, nonce, signature)
                  VALUES (${p.permissionId}, ${p.tenantId.toLowerCase()}, ${String(p.chainId)}, ${p.party.toLowerCase()},
                          ${p.scopes}, ${p.expiresAt.toString()}, ${p.nonce.toLowerCase()}, ${p.signature.toLowerCase()})
                  ON CONFLICT (tenant_id, chain_id, party, nonce) DO NOTHING
                  RETURNING permission_id`,
    )) as unknown[];
    return rows.length === 1;
  },

  async permissionsFor(tenantId: Hex, chainId: number, party: Address) {
    const rows = (await withDbRetry(
      () => sql()`SELECT permission_id, tenant_id, chain_id, party, scopes, expires_at, revoked_at
                  FROM tenant_permissions
                  WHERE tenant_id = ${tenantId.toLowerCase()} AND chain_id = ${String(chainId)} AND party = ${party.toLowerCase()}`,
    )) as PermissionDbRow[];
    return rows.map(toPermission);
  },

  async revokePermission(tenantId: Hex, permissionId: string) {
    const rows = (await withDbRetry(
      () => sql()`UPDATE tenant_permissions SET revoked_at = now()
                  WHERE permission_id = ${permissionId} AND tenant_id = ${tenantId.toLowerCase()} AND revoked_at IS NULL
                  RETURNING permission_id`,
    )) as unknown[];
    return rows.length === 1;
  },
};

export async function tagProposalTenant(token: string, tenantId: Hex): Promise<void> {
  await withDbRetry(() => sql()`UPDATE netting_proposals SET created_by_tenant = ${tenantId.toLowerCase()} WHERE token = ${token}`);
}

export type IdempotencyClaim =
  | { kind: "new" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" }
  | { kind: "in_progress" };

/// Reserves (tenant, key) before the request runs, so two concurrent retries can't both execute.
/// A reservation is stored with status 0 until `completeIdempotency` fills it in.
export async function claimIdempotency(tenantId: Hex, key: string, requestHash: string): Promise<IdempotencyClaim> {
  const inserted = (await withDbRetry(
    () => sql()`INSERT INTO api_idempotency (tenant_id, idem_key, request_hash, status_code, response)
                VALUES (${tenantId.toLowerCase()}, ${key}, ${requestHash}, 0, 'null'::jsonb)
                ON CONFLICT (tenant_id, idem_key) DO NOTHING RETURNING idem_key`,
  )) as unknown[];
  if (inserted.length === 1) return { kind: "new" };
  const rows = (await withDbRetry(
    () => sql()`SELECT request_hash, status_code, response FROM api_idempotency
                WHERE tenant_id = ${tenantId.toLowerCase()} AND idem_key = ${key}`,
  )) as { request_hash: string; status_code: number; response: unknown }[];
  const row = rows[0];
  if (!row || row.request_hash !== requestHash) return { kind: "conflict" };
  if (row.status_code === 0) return { kind: "in_progress" };
  return { kind: "replay", status: row.status_code, body: row.response };
}

export async function completeIdempotency(tenantId: Hex, key: string, status: number, body: unknown): Promise<void> {
  await withDbRetry(
    () => sql()`UPDATE api_idempotency SET status_code = ${status}, response = ${JSON.stringify(body)}::jsonb
                WHERE tenant_id = ${tenantId.toLowerCase()} AND idem_key = ${key}`,
  );
}

/// A failed request releases its key, so the tenant can retry with the same one.
export async function releaseIdempotency(tenantId: Hex, key: string): Promise<void> {
  await withDbRetry(
    () => sql()`DELETE FROM api_idempotency WHERE tenant_id = ${tenantId.toLowerCase()} AND idem_key = ${key} AND status_code = 0`,
  );
}
