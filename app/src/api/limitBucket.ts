/// API calls share the obligation/certificate rate limiter with the web app. Without a bucket the
/// tenant and the party's browser would draw from one counter. AsyncLocalStorage keeps the web
/// app's signatures unchanged: it still passes only the party address.

import { AsyncLocalStorage } from "node:async_hooks";

export interface LimitHit {
  limit: number;
  /// Unix seconds when the window that tripped resets.
  reset: number;
}

interface Store {
  bucket: string;
  onHit?: (hit: LimitHit) => void;
}

const storage = new AsyncLocalStorage<Store>();

export function withApiLimitBucket<T>(tenantId: string, fn: () => T, onHit?: (hit: LimitHit) => void): T {
  return storage.run({ bucket: `tenant:${tenantId.toLowerCase()}`, onHit }, fn);
}

/// True inside an API request: the budgets for a tenant's calls are separate from the web app's.
export function inApiBucket(): boolean {
  return storage.getStore()?.bucket.startsWith("tenant:") === true;
}

/// Tells an API request which per-party budget refused it, so the response can carry that
/// budget's `RateLimit-*` and `Retry-After` instead of the tenant's.
export function reportLimitHit(hit: LimitHit): void {
  storage.getStore()?.onHit?.(hit);
}

export function serviceRateLimitKey(prefix: "obligations" | "certificates", kind: string, address: string): string {
  const bucket = storage.getStore()?.bucket ?? "web";
  return `${prefix}:${kind}:${bucket}:${address.toLowerCase()}`;
}
