/// The shared database handle. All raw parameterized SQL goes through it: the schema is small and
/// stable enough that an ORM's generated types would add more than they save.

import { createDb, type Db } from "./postgres";

let cached: Db | undefined;

export function sql(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing required env var DATABASE_URL — see app/.env.example");
    cached = createDb(url);
  }
  return cached;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/// Errors from failing to *reach* the database, before any statement could have been sent. Only these
/// are safe to retry for a write as well as a read; an error mid-query (a reset connection, a timeout
/// while running) may have committed, and retrying it could repeat the write.
const NOT_REACHED_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "57P03", // the database is starting up
  "53300", // too many connections, refused at connect
]);

export function isDbNotReachedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && NOT_REACHED_CODES.has(code)) return true;
  // node-postgres's own message when the pool can't hand out a connection in time.
  return /timeout exceeded when trying to connect/i.test(error.message);
}

/// Retries a call that failed to reach the database. Live-verified necessary against the previous
/// provider, whose connections failed intermittently while the very same query succeeded seconds
/// before and after. A genuine query error (bad SQL, a constraint violation) fails immediately: retrying
/// would only repeat the same wrong result.
export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isDbNotReachedError(err) || attempt === attempts - 1) throw err;
      await sleep(200 * 2 ** attempt);
    }
  }
  throw lastErr;
}
