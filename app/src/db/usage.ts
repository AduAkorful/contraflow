/// Postgres side of tenant usage (see `src/api/usage.ts`). Every query is filtered by a tenant ID that
/// comes from the caller's key or the owner's session, never from a request value.

import { sql, withDbRetry } from "./client";
import {
  permissionState,
  USAGE_PARTY_PAGE,
  USAGE_RETENTION_DAYS,
  type StatusClass,
  type TenantUsage,
  type UsageParty,
  type UsageRecord,
} from "../api/usage";

/// A key is stamped at most this often, so reads don't become a write on every call.
const KEY_TOUCH_INTERVAL = "1 minute";

export async function recordUsage(r: UsageRecord): Promise<void> {
  await withDbRetry(
    () => sql()`INSERT INTO tenant_usage_daily (tenant_id, day, operation, party, status_class, error_code, count)
                VALUES (${r.tenantId.toLowerCase()}, (now() AT TIME ZONE 'utc')::date, ${r.operation}, ${r.party},
                        ${r.statusClass}, ${r.errorCode}, 1)
                ON CONFLICT (tenant_id, day, operation, party, status_class, error_code)
                DO UPDATE SET count = tenant_usage_daily.count + 1`,
  );
  if (r.keyHash) {
    await withDbRetry(
      () => sql()`UPDATE tenant_api_keys SET last_used_at = now()
                  WHERE key_hash = ${r.keyHash}
                    AND (last_used_at IS NULL OR last_used_at < now() - ${KEY_TOUCH_INTERVAL}::interval)`,
    );
  }
}

export async function purgeOldUsage(): Promise<number> {
  const rows = (await withDbRetry(
    () => sql()`DELETE FROM tenant_usage_daily
                WHERE day < ((now() AT TIME ZONE 'utc')::date - ${USAGE_RETENTION_DAYS}::int)
                RETURNING 1`,
  )) as unknown[];
  return rows.length;
}

interface UsageQuery {
  tenantId: string;
  from: string;
  to: string;
  party?: string;
  /// Party address to continue after (exclusive), in the page's sort order.
  cursor?: string;
  nowSeconds: bigint;
}

export async function getTenantUsage(q: UsageQuery): Promise<TenantUsage> {
  const tenantId = q.tenantId.toLowerCase();
  const partyFilter = q.party?.toLowerCase() ?? null;

  const rows = (await withDbRetry(
    () => sql()`SELECT day::text AS day, operation, party, status_class, error_code, count
                FROM tenant_usage_daily
                WHERE tenant_id = ${tenantId} AND day BETWEEN ${q.from}::date AND ${q.to}::date
                  AND (${partyFilter}::text IS NULL OR party = ${partyFilter})`,
  )) as { day: string; operation: string; party: string; status_class: StatusClass; error_code: string; count: number }[];

  const byStatusClass: Record<StatusClass, number> = { "2xx": 0, "4xx": 0, "5xx": 0 };
  const ops = new Map<string, { requests: number; errors: number }>();
  const errorCodes = new Map<string, number>();
  const days = new Map<string, { requests: number; errors: number }>();
  const partyAgg = new Map<string, { requests: number; errors: number; lastDay: string }>();
  let requests = 0;
  for (const r of rows) {
    const n = Number(r.count);
    const isError = r.status_class !== "2xx";
    requests += n;
    byStatusClass[r.status_class] += n;
    const op = ops.get(r.operation) ?? { requests: 0, errors: 0 };
    op.requests += n;
    if (isError) op.errors += n;
    ops.set(r.operation, op);
    if (isError && r.error_code) errorCodes.set(r.error_code, (errorCodes.get(r.error_code) ?? 0) + n);
    const d = days.get(r.day) ?? { requests: 0, errors: 0 };
    d.requests += n;
    if (isError) d.errors += n;
    days.set(r.day, d);
    if (r.party) {
      const p = partyAgg.get(r.party) ?? { requests: 0, errors: 0, lastDay: r.day };
      p.requests += n;
      if (isError) p.errors += n;
      if (r.day > p.lastDay) p.lastDay = r.day;
      partyAgg.set(r.party, p);
    }
  }

  const keys = (await withDbRetry(
    () => sql()`SELECT prefix, mode, last_used_at, revoked_at FROM tenant_api_keys
                WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`,
  )) as { prefix: string; mode: string; last_used_at: string | null; revoked_at: string | null }[];

  // Page the parties: most recently active first, ties by address, so the cursor is stable.
  const ordered = [...partyAgg.entries()]
    .map(([party, v]) => ({ party, ...v }))
    .sort((a, b) => (a.lastDay === b.lastDay ? a.party.localeCompare(b.party) : a.lastDay < b.lastDay ? 1 : -1));
  const cursor = q.cursor?.toLowerCase();
  const start = cursor ? ordered.findIndex((p) => p.party === cursor) + 1 : 0;
  const page = ordered.slice(start, start + USAGE_PARTY_PAGE);
  const nextCursor = start + USAGE_PARTY_PAGE < ordered.length ? (page[page.length - 1]?.party ?? null) : null;
  const pageParties = page.map((p) => p.party);

  const permissions = pageParties.length
    ? ((await withDbRetry(
        () => sql()`SELECT party, scopes, expires_at, revoked_at FROM tenant_permissions
                    WHERE tenant_id = ${tenantId} AND party = ANY(${pageParties})
                    ORDER BY created_at DESC`,
      )) as { party: string; scopes: number; expires_at: string; revoked_at: string | null }[])
    : [];
  // The newest grant per party decides its state.
  const newest = new Map<string, (typeof permissions)[number]>();
  for (const p of permissions) if (!newest.has(p.party)) newest.set(p.party, p);

  const events = pageParties.length
    ? ((await withDbRetry(
        () => sql()`SELECT lower(party) AS party, e.status, count(*)::int AS n
                    FROM webhook_events e,
                         LATERAL jsonb_array_elements_text((e.payload->>'body')::jsonb #> '{data,parties}') AS party
                    WHERE e.tenant_id = ${tenantId}
                      AND e.created_at >= ${q.from}::date AND e.created_at < (${q.to}::date + 1)
                      AND lower(party) = ANY(${pageParties})
                    GROUP BY 1, 2`,
      )) as { party: string; status: string; n: number }[])
    : [];
  const lastErrors = pageParties.length
    ? ((await withDbRetry(
        () => sql()`SELECT DISTINCT ON (lower(party)) lower(party) AS party, d.error
                    FROM webhook_events e
                    JOIN webhook_deliveries d ON d.event_id = e.event_id AND d.error IS NOT NULL,
                         LATERAL jsonb_array_elements_text((e.payload->>'body')::jsonb #> '{data,parties}') AS party
                    WHERE e.tenant_id = ${tenantId} AND lower(party) = ANY(${pageParties})
                      AND e.created_at >= ${q.from}::date AND e.created_at < (${q.to}::date + 1)
                    ORDER BY lower(party), d.attempted_at DESC`,
      )) as { party: string; error: string }[])
    : [];

  const parties: UsageParty[] = page.map((p) => {
    const perm = newest.get(p.party);
    const counts = { sent: 0, failed: 0, suppressed: 0 };
    for (const e of events) {
      if (e.party !== p.party) continue;
      if (e.status === "delivered") counts.sent += e.n;
      else if (e.status === "failed") counts.failed += e.n;
      else if (e.status === "suppressed") counts.suppressed += e.n;
    }
    return {
      party: p.party,
      requests: p.requests,
      errors: p.errors,
      lastRequestDay: p.lastDay,
      permission: {
        status: permissionState(
          perm ? { scopes: perm.scopes, expiresAt: BigInt(perm.expires_at), revoked: perm.revoked_at !== null } : null,
          q.nowSeconds,
        ),
        scopes: perm?.scopes ?? null,
        expiresAt: perm ? perm.expires_at : null,
      },
      webhooks: { ...counts, lastError: lastErrors.find((e) => e.party === p.party)?.error ?? null },
    };
  });

  return {
    from: q.from,
    to: q.to,
    totals: {
      requests,
      byStatusClass,
      byOperation: [...ops.entries()]
        .map(([operation, v]) => ({ operation, ...v }))
        .sort((a, b) => b.requests - a.requests),
      topErrorCodes: [...errorCodes.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    },
    daily: [...days.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    keys: keys.map((k) => ({
      prefix: k.prefix,
      mode: k.mode,
      lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString() : null,
      revoked: k.revoked_at !== null,
    })),
    parties,
    nextCursor,
  };
}
