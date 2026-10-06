/// Postgres store for self-serve API keys. The two-key cap is enforced inside one transaction
/// that locks the owned tenant row, so two clicks cannot both pass a count check.

import type { IssueTestKeyInput, OwnKeyStore, OwnKeyView, OwnTenantView } from "../api/ownKeys";
import { sql, withDbRetry } from "./client";

type KeyRow = {
  prefix: string;
  mode: "test" | "live";
  created_at: Date | string;
  revoked_at: Date | string | null;
};

type TenantRow = {
  tenant_id: string;
  status: "active" | "suspended";
};

function createdAtIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export const postgresOwnKeyStore: OwnKeyStore = {
  async issueTestKey(input: IssueTestKeyInput) {
    const ensure = sql()`INSERT INTO tenants (tenant_id, name, owner_address)
                         VALUES (${input.tenantId}, ${input.name}, ${input.owner})
                         ON CONFLICT (owner_address) WHERE owner_address IS NOT NULL DO NOTHING`;
    const lock = sql()`SELECT t.status,
                              (SELECT count(*)::int FROM tenant_api_keys k
                               WHERE k.tenant_id = t.tenant_id AND k.revoked_at IS NULL) AS active
                       FROM tenants t
                       WHERE t.owner_address = ${input.owner}
                       FOR UPDATE`;
    const insert = sql()`INSERT INTO tenant_api_keys (key_hash, tenant_id, mode, prefix)
                         SELECT ${input.keyHash}, t.tenant_id, 'test', ${input.prefix}
                         FROM tenants t
                         WHERE t.owner_address = ${input.owner}
                           AND t.status = 'active'
                           AND (SELECT count(*) FROM tenant_api_keys k
                                WHERE k.tenant_id = t.tenant_id AND k.revoked_at IS NULL) < 2
                         RETURNING tenant_id`;
    const [, locked, inserted] = await withDbRetry(() => sql().transaction([ensure, lock, insert]));
    if ((inserted ?? []).length === 1) return "issued";
    const row = (locked ?? [])[0] as { status?: string } | undefined;
    if (!row) return "unavailable";
    if (row.status !== "active") return "suspended";
    return "at_cap";
  },

  async list(owner: string) {
    const tenants = (await withDbRetry(
      () => sql()`SELECT tenant_id, status FROM tenants WHERE owner_address = ${owner}`,
    )) as TenantRow[];
    const tenant = tenants[0];
    if (!tenant) return null;
    const keys = (await withDbRetry(
      () => sql()`SELECT prefix, mode, created_at, revoked_at
                  FROM tenant_api_keys
                  WHERE tenant_id = ${tenant.tenant_id}
                  ORDER BY created_at DESC`,
    )) as KeyRow[];
    const view: OwnTenantView = {
      tenantId: tenant.tenant_id,
      status: tenant.status,
      keys: keys.map(
        (key): OwnKeyView => ({
          prefix: key.prefix,
          mode: key.mode,
          createdAt: createdAtIso(key.created_at),
          revoked: key.revoked_at !== null,
        }),
      ),
    };
    return view;
  },

  async revoke(owner: string, prefix: string) {
    const rows = (await withDbRetry(
      () => sql()`WITH matches AS (
                    SELECT k.key_hash
                    FROM tenant_api_keys k
                    JOIN tenants t ON t.tenant_id = k.tenant_id
                    WHERE t.owner_address = ${owner}
                      AND k.prefix = ${prefix}
                      AND k.revoked_at IS NULL
                    FOR UPDATE OF k
                  ),
                  updated AS (
                    UPDATE tenant_api_keys
                    SET revoked_at = now()
                    WHERE key_hash IN (SELECT key_hash FROM matches)
                      AND (SELECT count(*) FROM matches) = 1
                    RETURNING prefix
                  )
                  SELECT (SELECT count(*)::int FROM matches) AS matched,
                         (SELECT count(*)::int FROM updated) AS updated`,
    )) as { matched: number; updated: number }[];
    const row = rows[0];
    const updated = Number(row?.updated ?? 0);
    const matched = Number(row?.matched ?? 0);
    if (updated === 1) return "revoked";
    if (matched === 0) return "not_found";
    return "ambiguous";
  },
};
