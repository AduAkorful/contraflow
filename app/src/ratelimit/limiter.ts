/// Shared fixed-window rate limiter. One mechanism (`INCR` + `EXPIRE` on a window-scoped key)
/// serves the starter grant, the pre-check, and (lightly) the `/app/history` lookup, rather than
/// three bespoke limiters.

import { redis } from "../upstash/client";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  count: number;
}

/// Increments a fixed-window counter and returns its new value — the one primitive both
/// `checkRateLimit` (below) and anything that just needs a running count for its own separate cap
/// logic (e.g. `starterGrant.ts`'s daily-spend cap) build on, rather than each reimplementing the
/// `INCR`+`EXPIRE`-once shape.
export async function incrementWindowCounter(key: string, windowSeconds: number): Promise<number> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds);
  const windowKey = `ratelimit:${key}:${windowStart}`;

  const count = await redis().incr(windowKey);
  if (count === 1) {
    // Only the request that just created this window's counter sets its expiry — every
    // subsequent call in the same window just increments, avoiding a redundant EXPIRE per call.
    await redis().expire(windowKey, windowSeconds);
  }
  return count;
}

/// `key` should already include whatever this call is scoped to (an IP, a session address, a
/// route name) — this function only adds the time window, not an identity of its own.
export async function checkRateLimit(key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult> {
  const count = await incrementWindowCounter(key, windowSeconds);
  return { allowed: count <= maxRequests, remaining: Math.max(0, maxRequests - count), count };
}
