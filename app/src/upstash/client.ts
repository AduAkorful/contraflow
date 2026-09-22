/// Shared Upstash Redis client — factored out once a second module (the rate limiter,
/// plans/21-real-mode-attest-flow.md) needed the same connection `src/siwe/nonce.ts` already made.

import { Redis } from "@upstash/redis";

let cached: Redis | undefined;

export function redis(): Redis {
  if (!cached) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error("Missing UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN — see app/.env.example");
    }
    cached = new Redis({ url, token });
  }
  return cached;
}
