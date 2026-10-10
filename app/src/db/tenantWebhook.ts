/// Postgres store for a tenant's webhook endpoint, keyed by tenant id. The API reaches it with the
/// authenticated key's tenant, never a request value. Same shape as `ownWebhook.ts`, whose owner
/// argument is the tenant id here.

import type { Hex } from "viem";
import type { OwnDeliveryView, OwnWebhookStore, RemoveOutcome, RollOutcome, SaveOutcome } from "../api/ownWebhook";
import { sql, withDbRetry } from "./client";

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export const postgresTenantWebhookStore: OwnWebhookStore = {
  async get(tenantId) {
    const rows = (await withDbRetry(
      () => sql()`SELECT url, previous_expires_at FROM webhook_endpoints WHERE tenant_id = ${tenantId}`,
    )) as { url: string; previous_expires_at: Date | string | null }[];
    const row = rows[0];
    if (!row) return null;
    const rolling = row.previous_expires_at && new Date(row.previous_expires_at) > new Date() ? iso(row.previous_expires_at) : null;
    return { url: row.url, rollingUntil: rolling };
  },

  async tenant(tenantId) {
    const rows = (await withDbRetry(
      () => sql()`SELECT tenant_id, status FROM tenants WHERE tenant_id = ${tenantId}`,
    )) as { tenant_id: string; status: "active" | "suspended" }[];
    const row = rows[0];
    return row ? { tenantId: row.tenant_id as Hex, status: row.status } : null;
  },

  async save(tenantId, url, secret): Promise<SaveOutcome> {
    const rows = (await withDbRetry(
      () => sql()`INSERT INTO webhook_endpoints (tenant_id, url, secret)
                  SELECT t.tenant_id, ${url}, ${secret} FROM tenants t
                  WHERE t.tenant_id = ${tenantId} AND t.status = 'active'
                  ON CONFLICT (tenant_id) DO UPDATE SET url = EXCLUDED.url, secret = EXCLUDED.secret,
                    previous_secret = webhook_endpoints.secret, previous_expires_at = now() + interval '24 hours'
                  RETURNING tenant_id`,
    )) as unknown[];
    if (rows.length === 1) return "saved";
    return (await this.tenant(tenantId)) ? "suspended" : "no_tenant";
  },

  async roll(tenantId, secret): Promise<RollOutcome> {
    const rows = (await withDbRetry(
      () => sql()`UPDATE webhook_endpoints w
                  SET previous_secret = w.secret, previous_expires_at = now() + interval '24 hours', secret = ${secret}
                  FROM tenants t
                  WHERE t.tenant_id = w.tenant_id AND t.tenant_id = ${tenantId} AND t.status = 'active'
                  RETURNING w.tenant_id`,
    )) as unknown[];
    if (rows.length === 1) return "rolled";
    const tenant = await this.tenant(tenantId);
    if (!tenant) return "no_tenant";
    return tenant.status !== "active" ? "suspended" : "no_endpoint";
  },

  async remove(tenantId): Promise<RemoveOutcome> {
    // Queued events go with the endpoint so a later endpoint never receives stale ones.
    const suppress = sql()`UPDATE webhook_events SET status = 'suppressed'
                           WHERE status = 'pending' AND tenant_id = ${tenantId}`;
    const remove = sql()`DELETE FROM webhook_endpoints WHERE tenant_id = ${tenantId} RETURNING tenant_id`;
    const [, removed] = await withDbRetry(() => sql().transaction([suppress, remove]));
    return (removed ?? []).length === 1 ? "removed" : "no_endpoint";
  },

  async recent(tenantId) {
    const rows = (await withDbRetry(
      () => sql()`SELECT e.event_id, e.type, e.status, e.attempts, e.created_at, d.status_code, d.error
                  FROM webhook_events e
                  LEFT JOIN LATERAL (
                    SELECT status_code, error FROM webhook_deliveries x
                    WHERE x.event_id = e.event_id ORDER BY x.attempt DESC LIMIT 1
                  ) d ON true
                  WHERE e.tenant_id = ${tenantId}
                  ORDER BY e.created_at DESC LIMIT 10`,
    )) as {
      event_id: string;
      type: string;
      status: OwnDeliveryView["status"];
      attempts: number;
      created_at: Date | string;
      status_code: number | null;
      error: string | null;
    }[];
    return rows.map(
      (r): OwnDeliveryView => ({
        eventId: r.event_id,
        type: r.type,
        status: r.status,
        attempts: Number(r.attempts),
        createdAt: iso(r.created_at),
        statusCode: r.status_code,
        error: r.error,
      }),
    );
  },
};
