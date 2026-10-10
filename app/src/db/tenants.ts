/// Postgres implementation of the API's `TenantStore`. Access control lives in `src/api/auth.ts`;
/// this is data access only. Addresses and hex are stored lowercase.

import { getAddress, type Address, type Hex } from "viem";
import { randomUUID } from "node:crypto";
import type { IdempotencyContext, NewPermission, StoredKey, StoredPermission, TenantInfo, TenantStore } from "../api/auth";
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

export const postgresTenantStore: TenantStore = {
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

  async getTenant(tenantId: Hex) {
    const rows = (await withDbRetry(
      () => sql()`SELECT t.name, t.status, (w.tenant_id IS NOT NULL) AS webhook_configured
                  FROM tenants t
                  LEFT JOIN webhook_endpoints w ON w.tenant_id = t.tenant_id
                  WHERE t.tenant_id = ${tenantId.toLowerCase()}`,
    )) as { name: string; status: "active" | "suspended"; webhook_configured: boolean }[];
    const row = rows[0];
    if (!row) return null;
    return {
      name: row.name,
      status: row.status,
      webhookConfigured: Boolean(row.webhook_configured),
    } satisfies TenantInfo;
  },

  async savePermission(p: NewPermission, idempotency?: IdempotencyContext) {
    if (idempotency) {
      // The permission and its replayable HTTP result commit in one statement. If the process
      // dies after the database commits, the next same-key request sees the completed result instead of
      // rerunning validation/insertion and returning a misleading duplicate_nonce conflict.
      const rows = (await withDbRetry(
        () => sql()`WITH reservation AS MATERIALIZED (
                     SELECT 1 FROM api_idempotency
                     WHERE tenant_id = ${p.tenantId.toLowerCase()} AND idem_key = ${idempotency.key}
                       AND request_hash = ${idempotency.requestHash} AND status_code = 0
                       AND lease_token = ${idempotency.leaseToken}
                     FOR UPDATE
                   ), inserted AS (
                     INSERT INTO tenant_permissions
                       (permission_id, tenant_id, chain_id, party, scopes, expires_at, nonce, signature)
                     SELECT ${p.permissionId}, ${p.tenantId.toLowerCase()}, ${String(p.chainId)}, ${p.party.toLowerCase()},
                            ${p.scopes}, ${p.expiresAt.toString()}, ${p.nonce.toLowerCase()}, ${p.signature.toLowerCase()}
                     FROM reservation
                     ON CONFLICT (tenant_id, chain_id, party, nonce) DO NOTHING
                     RETURNING permission_id
                   ), finalized AS (
                     UPDATE api_idempotency AS idem
                     SET status_code = 201,
                         lease_token = NULL,
                         lease_expires_at = NULL,
                         response = jsonb_build_object(
                           'permissionId', inserted.permission_id,
                           'party', ${p.party}::text,
                           'scopes', ${p.scopes}::int,
                           'expiresAt', ${p.expiresAt.toString()}::text
                         )
                     FROM inserted
                     WHERE idem.tenant_id = ${p.tenantId.toLowerCase()} AND idem.idem_key = ${idempotency.key}
                       AND idem.request_hash = ${idempotency.requestHash} AND idem.status_code = 0
                     RETURNING idem.idem_key
                   )
                   SELECT permission_id FROM inserted
                   UNION ALL
                   SELECT ${p.permissionId}
                   WHERE EXISTS (
                     SELECT 1 FROM api_idempotency
                     WHERE tenant_id = ${p.tenantId.toLowerCase()} AND idem_key = ${idempotency.key}
                       AND request_hash = ${idempotency.requestHash} AND status_code = 201
                       AND response->>'permissionId' = ${p.permissionId}
                   )`,
      )) as { permission_id: string }[];
      return rows.length === 1;
    }
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
    )) as unknown as PermissionDbRow[];
    return rows.map(toPermission);
  },

  async listPermissions(tenantId: Hex, chainId: number, party?: Address) {
    const rows = (await withDbRetry(
      () =>
        party
          ? sql()`SELECT permission_id, tenant_id, chain_id, party, scopes, expires_at, revoked_at
                  FROM tenant_permissions
                  WHERE tenant_id = ${tenantId.toLowerCase()} AND chain_id = ${String(chainId)} AND party = ${party.toLowerCase()}
                  ORDER BY created_at DESC`
          : sql()`SELECT permission_id, tenant_id, chain_id, party, scopes, expires_at, revoked_at
                  FROM tenant_permissions
                  WHERE tenant_id = ${tenantId.toLowerCase()} AND chain_id = ${String(chainId)}
                  ORDER BY created_at DESC`,
    )) as unknown as PermissionDbRow[];
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
  | { kind: "new" | "recovered"; leaseToken: string }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" }
  | { kind: "in_progress" };

const IDEMPOTENCY_LEASE_SECONDS = 120;

/// Reserves (tenant, key) before the request runs. Only endpoint handlers that can reconcile
/// their mutation may reclaim an expired lease; a timeout alone never authorizes replay.
export async function claimIdempotency(
  tenantId: Hex,
  key: string,
  requestHash: string,
  recoverStale = false,
): Promise<IdempotencyClaim> {
  const leaseToken = randomUUID();
  const inserted = (await withDbRetry(
    () => sql()`INSERT INTO api_idempotency
                  (tenant_id, idem_key, request_hash, status_code, response, lease_token, lease_expires_at)
                VALUES (${tenantId.toLowerCase()}, ${key}, ${requestHash}, 0, 'null'::jsonb, ${leaseToken},
                        now() + (${IDEMPOTENCY_LEASE_SECONDS} * interval '1 second'))
                ON CONFLICT (tenant_id, idem_key) DO NOTHING RETURNING idem_key`,
  )) as unknown[];
  if (inserted.length === 1) return { kind: "new", leaseToken };
  const rows = (await withDbRetry(
    () => sql()`SELECT request_hash, status_code, response FROM api_idempotency
                WHERE tenant_id = ${tenantId.toLowerCase()} AND idem_key = ${key}`,
  )) as { request_hash: string; status_code: number; response: unknown }[];
  const row = rows[0];
  if (!row || row.request_hash !== requestHash) return { kind: "conflict" };
  if (row.status_code === 0) {
    if (!recoverStale) return { kind: "in_progress" };
    const recovered = (await withDbRetry(
      () => sql()`UPDATE api_idempotency
                  SET lease_token = ${leaseToken},
                      lease_expires_at = now() + (${IDEMPOTENCY_LEASE_SECONDS} * interval '1 second')
                  WHERE tenant_id = ${tenantId.toLowerCase()} AND idem_key = ${key}
                    AND request_hash = ${requestHash} AND status_code = 0
                    AND lease_expires_at <= now()
                  RETURNING idem_key`,
    )) as unknown[];
    if (recovered.length === 1) return { kind: "recovered", leaseToken };
    // The old worker may have completed while this claim waited for its row lock.
    const latest = (await withDbRetry(
      () => sql()`SELECT request_hash, status_code, response FROM api_idempotency
                  WHERE tenant_id = ${tenantId.toLowerCase()} AND idem_key = ${key}`,
    )) as { request_hash: string; status_code: number; response: unknown }[];
    const current = latest[0];
    if (!current || current.request_hash !== requestHash) return { kind: "conflict" };
    if (current.status_code === 0) return { kind: "in_progress" };
    return { kind: "replay", status: current.status_code, body: current.response };
  }
  return { kind: "replay", status: row.status_code, body: row.response };
}

export async function completeIdempotency(
  tenantId: Hex,
  key: string,
  status: number,
  body: unknown,
  leaseToken: string,
): Promise<void> {
  await withDbRetry(
    () => sql()`UPDATE api_idempotency
                SET status_code = ${status}, response = ${JSON.stringify(body)}::jsonb,
                    lease_token = NULL, lease_expires_at = NULL
                WHERE tenant_id = ${tenantId.toLowerCase()} AND idem_key = ${key}
                  AND status_code = 0 AND lease_token = ${leaseToken}`,
  );
}

/// Records a response found by looking up the mutation's effect, without holding the lease. Only
/// for in-progress keys whose request hash still matches; a different body stays a conflict.
export async function completeIdempotencyFromEffect(
  tenantId: Hex,
  key: string,
  requestHash: string,
  status: number,
  body: unknown,
): Promise<void> {
  await withDbRetry(
    () => sql()`UPDATE api_idempotency
                SET status_code = ${status}, response = ${JSON.stringify(body)}::jsonb,
                    lease_token = NULL, lease_expires_at = NULL
                WHERE tenant_id = ${tenantId.toLowerCase()} AND idem_key = ${key}
                  AND request_hash = ${requestHash} AND status_code = 0`,
  );
}
