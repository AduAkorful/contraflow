/// Thin wrapper around `@neondatabase/serverless`'s HTTP driver — chosen over an ORM (Drizzle,
/// Prisma) to keep dependencies minimal. The schema is small and stable enough that raw
/// parameterized SQL is clearer than an ORM's generated types would be.

import { neon } from "@neondatabase/serverless";

let cached: ReturnType<typeof neon> | undefined;

export function sql() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing required env var DATABASE_URL — see app/.env.example");
    cached = neon(url);
  }
  return cached;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/// Retries a Neon HTTP-driver call on a transient connect failure — live-verified necessary, not
/// precautionary: this session hit real `ETIMEDOUT`/`ENETUNREACH` connecting to Neon's pooler IPs,
/// intermittently, from otherwise-working network conditions (the exact same query succeeded
/// seconds before and after a failure). Only retries `NeonDbError`s whose message mentions
/// `fetch failed` — a genuine query error (bad SQL, constraint violation) fails immediately, same
/// as before, since retrying those would just repeat the same wrong result three times.
export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("fetch failed") || attempt === attempts - 1) throw err;
      await sleep(200 * 2 ** attempt);
    }
  }
  throw lastErr;
}
