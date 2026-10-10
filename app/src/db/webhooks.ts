/// Postgres implementation of the webhook pipeline's store. Claims use `FOR UPDATE SKIP LOCKED` inside a
/// single statement, so overlapping runs never take the same change or event.

import { getAddress, isAddress, type Address, type Hex } from "viem";
import { randomUUID } from "node:crypto";
import type { ChangeContext, DueEvent, PendingChange, WebhookStore } from "../api/webhookPipeline";
import { sql, withDbRetry } from "./client";

/// How long a claimed event stays leased before another run may retry it.
const LEASE = "5 minutes";

export const postgresWebhookStore: WebhookStore = {
  async claimChanges(limit) {
    const rows = (await withDbRetry(
      () => sql()`UPDATE netting_changes SET claimed_at = now()
                  WHERE change_id IN (SELECT change_id FROM netting_changes
                                      WHERE processed_at IS NULL AND (claimed_at IS NULL OR claimed_at < now() - ${LEASE}::interval)
                                      ORDER BY change_id LIMIT ${limit} FOR UPDATE SKIP LOCKED)
                  RETURNING change_id, kind, ref_id, chain_id, status`,
    )) as { change_id: string; kind: "obligation" | "certificate"; ref_id: string; chain_id: string; status: string }[];
    return rows
      .map((r): PendingChange => ({ changeId: String(r.change_id), kind: r.kind, refId: r.ref_id, chainId: r.chain_id, status: r.status }))
      .sort((a, b) => Number(a.changeId) - Number(b.changeId));
  },

  async completeChange(changeId) {
    await withDbRetry(() => sql()`UPDATE netting_changes SET processed_at = now() WHERE change_id = ${changeId}`);
  },

  async changeContext(change): Promise<ChangeContext | null> {
    if (change.kind === "obligation") {
      const rows = (await withDbRetry(
        () => sql()`SELECT debtor, creditor FROM netting_obligations WHERE obligation_id = ${change.refId}`,
      )) as { debtor: string; creditor: string }[];
      const row = rows[0];
      return row ? { parties: [getAddress(row.debtor), getAddress(row.creditor)] } : null;
    }
    const rows = (await withDbRetry(
      () => sql()`SELECT c.token, e.debtor, e.creditor FROM netting_certificates c
                  JOIN netting_certificate_entries e ON e.certificate_id = c.certificate_id
                  WHERE c.certificate_id = ${change.refId}`,
    )) as { token: string; debtor: string; creditor: string }[];
    if (rows.length === 0) return null;
    const parties = [...new Set(rows.flatMap((r) => [r.debtor, r.creditor]))].map((a) => getAddress(a));
    return { parties, token: rows[0]!.token };
  },

  async readersOf(chainId, parties, nowSeconds) {
    if (parties.length === 0) return [];
    const rows = (await withDbRetry(
      () => sql()`SELECT DISTINCT p.tenant_id, p.party FROM tenant_permissions p
                  JOIN webhook_endpoints w ON w.tenant_id = p.tenant_id
                  JOIN tenants t ON t.tenant_id = p.tenant_id AND t.status = 'active'
                  WHERE p.chain_id = ${chainId} AND p.party = ANY(${parties.map((a) => a.toLowerCase())})
                    AND p.revoked_at IS NULL AND p.expires_at > ${nowSeconds.toString()} AND (p.scopes & 1) = 1`,
    )) as { tenant_id: string; party: string }[];
    const byTenant = new Map<string, Address[]>();
    for (const r of rows) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), getAddress(r.party)]);
    return [...byTenant].map(([tenantId, ps]) => ({ tenantId: tenantId as Hex, parties: ps }));
  },

  async insertEvent(e) {
    await withDbRetry(
      () => sql()`INSERT INTO webhook_events (event_id, tenant_id, type, payload)
                  VALUES (${e.eventId}, ${e.tenantId.toLowerCase()}, ${e.type}, ${JSON.stringify({ body: e.body })}::jsonb)
                  ON CONFLICT (event_id) DO NOTHING`,
    );
  },

  async claimDueEvents(limit) {
    const rows = (await withDbRetry(
      () => sql()`UPDATE webhook_events ev SET next_attempt_at = now() + ${LEASE}::interval
                  FROM webhook_endpoints w
                  WHERE w.tenant_id = ev.tenant_id AND ev.event_id IN (
                    SELECT event_id FROM webhook_events WHERE status = 'pending' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
                  RETURNING ev.event_id, ev.tenant_id, ev.payload, ev.attempts, ev.created_at, w.url, w.secret,
                            w.previous_secret, w.previous_expires_at`,
    )) as {
      event_id: string;
      tenant_id: string;
      payload: { body: string };
      attempts: number;
      created_at: string;
      url: string;
      secret: string;
      previous_secret: string | null;
      previous_expires_at: string | null;
    }[];
    return rows.map(
      (r): DueEvent => ({
        eventId: r.event_id,
        tenantId: r.tenant_id as Hex,
        body: r.payload.body,
        attempts: r.attempts,
        createdAt: new Date(r.created_at),
        url: r.url,
        secrets:
          r.previous_secret && r.previous_expires_at && new Date(r.previous_expires_at) > new Date()
            ? [r.secret, r.previous_secret]
            : [r.secret],
      }),
    );
  },

  async hasCurrentReadAccess(event, nowSeconds) {
    let chainId: string;
    let parties: string[];
    try {
      const body = JSON.parse(event.body) as { type?: unknown; chainId?: unknown; data?: { parties?: unknown } };
      if (body.type === "webhook.test") {
        const tenantRows = (await withDbRetry(
          () => sql()`SELECT status FROM tenants WHERE tenant_id = ${event.tenantId.toLowerCase()}`,
        )) as { status: string }[];
        return tenantRows[0]?.status === "active";
      }
      // The event body carries the chain ID as a JSON number; stored rows from before that change may hold a string.
      const bodyChainId = typeof body.chainId === "number" && Number.isSafeInteger(body.chainId) ? String(body.chainId) : body.chainId;
      if (typeof bodyChainId !== "string" || !/^\d+$/.test(bodyChainId) || !Array.isArray(body.data?.parties)) return false;
      if (body.data.parties.length === 0 || body.data.parties.some((party) => typeof party !== "string" || !isAddress(party))) {
        return false;
      }
      chainId = bodyChainId;
      parties = [...new Set((body.data.parties as string[]).map((party) => party.toLowerCase()))];
    } catch {
      return false;
    }

    const rows = (await withDbRetry(
      () => sql()`SELECT COUNT(DISTINCT p.party)::int AS authorized_count
                  FROM tenant_permissions p
                  JOIN tenants t ON t.tenant_id = p.tenant_id AND t.status = 'active'
                  WHERE p.tenant_id = ${event.tenantId.toLowerCase()}
                    AND p.chain_id = ${chainId}
                    AND p.party = ANY(${parties})
                    AND p.revoked_at IS NULL
                    AND p.expires_at > ${nowSeconds.toString()}
                    AND (p.scopes & 1) = 1`,
    )) as { authorized_count: number }[];
    return Number(rows[0]?.authorized_count ?? 0) === parties.length;
  },

  async recordAttempt(eventId, attempt, result, outcome) {
    await withDbRetry(
      () => sql()`INSERT INTO webhook_deliveries (event_id, attempt, status_code, error)
                  VALUES (${eventId}, ${attempt}, ${result.statusCode}, ${result.error?.slice(0, 500) ?? null})
                  ON CONFLICT (event_id, attempt) DO NOTHING`,
    );
    const status = outcome.kind === "retry" ? "pending" : outcome.kind;
    const nextAt = outcome.kind === "retry" ? outcome.nextAt.toISOString() : new Date().toISOString();
    await withDbRetry(
      () => sql()`UPDATE webhook_events SET attempts = ${attempt}, status = ${status}, next_attempt_at = ${nextAt}
                  WHERE event_id = ${eventId}`,
    );
  },
};

export async function enqueueWebhookTest(tenantId: Hex, chainId: number): Promise<{ eventId: string } | { error: "no_endpoint" }> {
  const endpoints = (await withDbRetry(
    () => sql()`SELECT tenant_id FROM webhook_endpoints WHERE tenant_id = ${tenantId.toLowerCase()}`,
  )) as { tenant_id: string }[];
  if (endpoints.length === 0) return { error: "no_endpoint" };
  const eventId = `evt_test_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const body = JSON.stringify({
    id: eventId,
    type: "webhook.test",
    created: Math.floor(Date.now() / 1000),
    chainId: String(chainId),
    data: { ok: true },
  });
  await postgresWebhookStore.insertEvent({ eventId, tenantId, type: "webhook.test", body });
  return { eventId };
}
