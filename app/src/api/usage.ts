/// What the API records about a tenant's own calls, and the shapes `GET /usage` and the dashboard
/// return. Counts only: operation, acting party, status class and error code per day. Never request
/// contents, amounts or IPs.

import type { Hex } from "viem";

export const USAGE_RETENTION_DAYS = 90;
export const USAGE_PARTY_PAGE = 50;
/// A permission counts as "expiring" when it ends within this many seconds.
export const EXPIRING_WITHIN_SECONDS = 7 * 24 * 3600;

export type StatusClass = "2xx" | "4xx" | "5xx";

export interface UsageRecord {
  tenantId: Hex;
  /// OpenAPI operationId.
  operation: string;
  /// Lowercase address, or "" when the call isn't tied to a party.
  party: string;
  statusClass: StatusClass;
  errorCode: string;
  /// sha256 of the key that made the call, to stamp `last_used_at`.
  keyHash: string | null;
}

export type PermissionState = "live" | "expiring" | "expired" | "revoked" | "none";

export interface UsageParty {
  party: string;
  requests: number;
  errors: number;
  lastRequestDay: string | null;
  permission: { status: PermissionState; scopes: number | null; expiresAt: string | null };
  webhooks: { sent: number; failed: number; suppressed: number; lastError: string | null };
}

export interface TenantUsage {
  from: string;
  to: string;
  totals: {
    requests: number;
    byStatusClass: Record<StatusClass, number>;
    byOperation: { operation: string; requests: number; errors: number }[];
    topErrorCodes: { code: string; count: number }[];
  };
  daily: { day: string; requests: number; errors: number }[];
  keys: { prefix: string; mode: string; lastUsedAt: string | null; revoked: boolean }[];
  parties: UsageParty[];
  nextCursor: string | null;
}

export function statusClassOf(status: number): StatusClass {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  return "2xx";
}

/// A probe for a party the tenant has no permission for answers 404 (or 401/403), so those are never
/// attributed to the address in the request: otherwise a tenant could grow rows for arbitrary
/// addresses. Everything else was decided for a party the tenant actually reached.
export function attributedParty(status: number, party: string | null): string {
  if (!party) return "";
  if (status === 401 || status === 403 || status === 404) return "";
  return /^0x[0-9a-fA-F]{40}$/.test(party) ? party.toLowerCase() : "";
}

export function permissionState(
  p: { scopes: number; expiresAt: bigint; revoked: boolean } | null,
  nowSeconds: bigint,
): PermissionState {
  if (!p) return "none";
  if (p.revoked) return "revoked";
  if (p.expiresAt <= nowSeconds) return "expired";
  return p.expiresAt - nowSeconds <= BigInt(EXPIRING_WITHIN_SECONDS) ? "expiring" : "live";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/// Parses `from`/`to` (yyyy-mm-dd, UTC). Defaults to the last 30 days. At most 90 days, never in the
/// future past today.
export function parseUsageRange(
  fromParam: string | null,
  toParam: string | null,
  now: Date,
): { ok: true; from: string; to: string } | { ok: false; message: string } {
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const to = toParam ?? isoDay(now);
  const from = fromParam ?? isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000));
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return { ok: false, message: "from and to must be dates like 2026-10-01." };
  }
  if (from > to) return { ok: false, message: "from must not be after to." };
  if (to > isoDay(now)) return { ok: false, message: "to must not be in the future." };
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span > USAGE_RETENTION_DAYS) return { ok: false, message: `The range can be at most ${USAGE_RETENTION_DAYS} days.` };
  return { ok: true, from, to };
}
