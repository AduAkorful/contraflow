/// The logic behind `scripts/reset-data.mjs`: wiping every row of the app's own tables (schema,
/// row-level security and lockdown kept) and the cache keys that belong to the chain being left.
/// It is split out so the destructive parts are small, readable and tested.
///
/// Nothing here runs by itself. The script decides whether to execute; every function that deletes
/// something takes the thing it deletes from as an argument.

import type { Db, DbQuery, Row } from "./postgres";

/// Tables that track the database itself rather than hold app data. Never truncated. (The app has
/// none today; the migration runner is stateless.)
export const TRACKING_TABLES: readonly string[] = ["schema_migrations", "_migrations", "migrations"];

/// Cache and counter key prefixes in Redis that belong to the chain being left. They are removed
/// with SCAN and DEL, never FLUSHALL: the same Redis may hold unrelated keys.
export const REDIS_PREFIXES: readonly string[] = [
  "demo:", // demo runs, per-IP and budget counters, operations
  "siwe:nonce:", // issued, unused sign-in nonces
  "ratelimit:", // every fixed-window counter (starter grant, API keys, quotes, public reads, ...)
  "starter-grant-count:",
  "starter-grant:",
  "api:", // webhook pipeline lock, tenant limits
  "api-keys:",
  "stats:", // protocol stats, keyed on the old chain's contracts
  "inspector:", // cached onchain facts about the old chain's addresses
  "eurc-quote:",
  "settle:", // cached invoice-loop searches
  "chainidx:", // the chain index of the old deployment
];

/// Kept on purpose. A signed-out session's hash stays on the deny-list until the cookie would have
/// expired; deleting it would let a copied, signed-out cookie work again. They expire on their own
/// within a day. Pass `includeRevocations` only together with a new `SESSION_SECRET`.
export const REVOCATION_PREFIX = "session:revoked:";

export function redisPrefixesToSweep(includeRevocations: boolean): string[] {
  return includeRevocations ? [...REDIS_PREFIXES, REVOCATION_PREFIX] : [...REDIS_PREFIXES];
}

/// The Supabase project a connection string points at, or null when it can't be told (a local or
/// self-hosted database). Pooler strings carry it in the user name (`postgres.<ref>`), direct
/// strings in the host (`db.<ref>.supabase.co`).
export function projectRefFromDatabaseUrl(connectionString: string): string | null {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return null;
  }
  const user = decodeURIComponent(url.username);
  const fromUser = /^postgres\.([a-z0-9]{10,})$/.exec(user);
  if (fromUser) return fromUser[1]!;
  const fromHost = /^db\.([a-z0-9]{10,})\.supabase\.(?:co|com)$/i.exec(url.hostname);
  return fromHost ? fromHost[1]!.toLowerCase() : null;
}

export function isLocalDatabase(connectionString: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

/// What the operator must pass as `--confirm`: the project ref, or `local` for a local database.
export function expectedConfirmation(connectionString: string): string | null {
  return projectRefFromDatabaseUrl(connectionString) ?? (isLocalDatabase(connectionString) ? "local" : null);
}

type Queryable = Pick<Db, "query" | "transaction">;

/// Every table in `public` except the tracking tables, read from the database, never hand-typed.
export async function discoverTables(db: Queryable): Promise<string[]> {
  const rows = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return rows.map((r: Row) => String(r.tablename)).filter((name) => !TRACKING_TABLES.includes(name));
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function countRows(db: Queryable, tables: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await db.query(`SELECT count(*)::int AS n FROM public.${quoteIdent(table)}`);
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

export interface LockdownReport {
  /// Tables in `public` with row-level security off.
  rlsOff: string[];
  /// `anon` / `authenticated` privileges on public tables, sequences or functions.
  grants: string[];
}

/// The lockdown the app relies on (migration 011): RLS on for every table, and the Data API roles
/// holding nothing. Read-only.
export async function checkLockdown(db: Queryable): Promise<LockdownReport> {
  const rlsOff = await db.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY c.relname`,
  );
  // The roles exist on Supabase; a plain Postgres has neither, which is no grant at all.
  const roles = await db.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`);
  const grants: string[] = [];
  for (const { rolname } of roles) {
    const role = String(rolname);
    const tables = await db.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
         AND (has_table_privilege($1, c.oid, 'SELECT') OR has_table_privilege($1, c.oid, 'INSERT')
           OR has_table_privilege($1, c.oid, 'UPDATE') OR has_table_privilege($1, c.oid, 'DELETE'))`,
      [role],
    );
    for (const t of tables) grants.push(`${role}: table ${String(t.relname)}`);
    const sequences = await db.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'S'
         AND (has_sequence_privilege($1, c.oid, 'USAGE') OR has_sequence_privilege($1, c.oid, 'SELECT')
           OR has_sequence_privilege($1, c.oid, 'UPDATE'))`,
      [role],
    );
    for (const s of sequences) grants.push(`${role}: sequence ${String(s.relname)}`);
    const functions = await db.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND has_function_privilege($1, p.oid, 'EXECUTE')`,
      [role],
    );
    for (const f of functions) grants.push(`${role}: function ${String(f.proname)}`);
  }
  return { rlsOff: rlsOff.map((r: Row) => String(r.relname)), grants };
}

export function lockdownHolds(report: LockdownReport): boolean {
  return report.rlsOff.length === 0 && report.grants.length === 0;
}

/// Empties every listed table in one transaction (`TRUNCATE ... RESTART IDENTITY CASCADE`): either
/// all of them are emptied or none is. Returns what was read back afterwards.
export async function truncateAll(db: Queryable, tables: readonly string[]): Promise<Record<string, number>> {
  if (tables.length === 0) throw new Error("No tables to wipe.");
  const list = tables.map((t) => `public.${quoteIdent(t)}`).join(", ");
  const queries: DbQuery[] = [db.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)];
  await db.transaction(queries);
  return countRows(db, tables);
}

export interface SweepClient {
  scan(cursor: string | number, options: { match: string; count: number }): Promise<[string | number, string[]]>;
  del(...keys: string[]): Promise<number>;
}

export interface SweepResult {
  prefix: string;
  found: number;
  deleted: number;
}

/// Counts (dry run) or deletes the keys under each prefix, in batches. Never `FLUSHALL`.
export async function sweepRedis(client: SweepClient, prefixes: readonly string[], execute: boolean): Promise<SweepResult[]> {
  const results: SweepResult[] = [];
  for (const prefix of prefixes) {
    let cursor: string | number = 0;
    let found = 0;
    let deleted = 0;
    do {
      const [next, keys] = await client.scan(cursor, { match: `${prefix}*`, count: 500 });
      cursor = next;
      found += keys.length;
      if (execute && keys.length > 0) {
        for (let i = 0; i < keys.length; i += 100) deleted += await client.del(...keys.slice(i, i + 100));
      }
    } while (String(cursor) !== "0");
    results.push({ prefix, found, deleted });
  }
  return results;
}
