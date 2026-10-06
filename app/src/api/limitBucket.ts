/// API calls share the obligation/certificate rate limiter with the web app. Without a bucket the
/// tenant and the party's browser would draw from one counter. AsyncLocalStorage keeps the web
/// app's signatures unchanged: it still passes only the party address.

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();

export function withApiLimitBucket<T>(tenantId: string, fn: () => T): T {
  return storage.run(`tenant:${tenantId.toLowerCase()}`, fn);
}

export function serviceRateLimitKey(prefix: "obligations" | "certificates", kind: string, address: string): string {
  const bucket = storage.getStore() ?? "web";
  return `${prefix}:${kind}:${bucket}:${address.toLowerCase()}`;
}
