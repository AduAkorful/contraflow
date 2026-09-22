/// Shared Upstash Redis client — factored out so the rate limiter and `src/siwe/nonce.ts` reuse
/// the same connection instead of each opening their own.

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
