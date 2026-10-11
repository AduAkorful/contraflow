import { describe, expect, it, vi } from "vitest";
import {
  REDIS_PREFIXES,
  REVOCATION_PREFIX,
  countRows,
  discoverTables,
  expectedConfirmation,
  isLocalDatabase,
  lockdownHolds,
  projectRefFromDatabaseUrl,
  redisPrefixesToSweep,
  sweepRedis,
  truncateAll,
  type SweepClient,
} from "../src/db/resetData";

const REF = "abcdefghijklmnopqrst";

function fakeDb(rowsFor: (text: string) => Record<string, unknown>[] = () => []) {
  const statements: string[] = [];
  const transactions: string[][] = [];
  const make = (text: string, values: readonly unknown[] = []) => {
    const run = Promise.resolve(rowsFor(text));
    return Object.assign(run, { text, values });
  };
  const db = {
    statements,
    transactions,
    query: (text: string, values?: readonly unknown[]) => {
      statements.push(text);
      return make(text, values);
    },
    transaction: async (queries: readonly { text: string }[]) => {
      transactions.push(queries.map((q) => q.text));
      return queries.map(() => []);
    },
  };
  return db as unknown as Parameters<typeof discoverTables>[0] & typeof db;
}

describe("which database a connection string points at", () => {
  it("reads the project from a pooler user name and from a direct host", () => {
    expect(projectRefFromDatabaseUrl(`postgresql://postgres.${REF}:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`)).toBe(REF);
    expect(projectRefFromDatabaseUrl(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`)).toBe(REF);
  });

  it("can't tell for anything else", () => {
    expect(projectRefFromDatabaseUrl("postgresql://postgres:pw@127.0.0.1:5432/app")).toBeNull();
    expect(projectRefFromDatabaseUrl("postgresql://postgres:pw@db.example.com/app")).toBeNull();
    expect(projectRefFromDatabaseUrl("not a url")).toBeNull();
  });

  it("asks for the project ref, or `local`, and nothing for an unknown database", () => {
    expect(expectedConfirmation(`postgresql://postgres.${REF}:pw@h.pooler.supabase.com:6543/postgres`)).toBe(REF);
    expect(isLocalDatabase("postgresql://postgres:pw@localhost:5432/app")).toBe(true);
    expect(expectedConfirmation("postgresql://postgres:pw@127.0.0.1:5432/app")).toBe("local");
    expect(expectedConfirmation("postgresql://postgres:pw@db.example.com/app")).toBeNull();
  });
});

describe("what gets swept from Redis", () => {
  it("covers the chain-bound caches and counters, including the chain index", () => {
    for (const prefix of ["demo:", "siwe:nonce:", "ratelimit:", "stats:", "inspector:", "chainidx:", "settle:", "eurc-quote:", "api:", "api-keys:"]) {
      expect(REDIS_PREFIXES).toContain(prefix);
    }
  });

  it("keeps the signed-out session deny-list unless asked", () => {
    expect(redisPrefixesToSweep(false)).not.toContain(REVOCATION_PREFIX);
    expect(redisPrefixesToSweep(true)).toContain(REVOCATION_PREFIX);
  });

  it("never touches a key outside the listed prefixes", () => {
    const all = redisPrefixesToSweep(true);
    expect(all.every((p) => p.endsWith(":"))).toBe(true);
    expect(all).not.toContain("");
  });

  it("counts on a dry run and deletes in bounded batches when executing", async () => {
    const pages: Record<string, [string, string[]]> = {
      "0": ["7", Array.from({ length: 150 }, (_, i) => `demo:a${i}`)],
      "7": ["0", ["demo:last"]],
    };
    const del = vi.fn(async (...keys: string[]) => keys.length);
    const scan = vi.fn(async (cursor: string | number) => pages[String(cursor)]!);
    const client: SweepClient = { scan: scan as SweepClient["scan"], del };

    const dry = await sweepRedis(client, ["demo:"], false);
    expect(dry).toEqual([{ prefix: "demo:", found: 151, deleted: 0 }]);
    expect(del).not.toHaveBeenCalled();

    const real = await sweepRedis(client, ["demo:"], true);
    expect(real).toEqual([{ prefix: "demo:", found: 151, deleted: 151 }]);
    expect(Math.max(...del.mock.calls.map((c) => c.length))).toBeLessThanOrEqual(100);
    expect(scan).toHaveBeenCalledWith(0, { match: "demo:*", count: 500 });
  });
});

describe("the database wipe", () => {
  it("discovers tables from the database and skips tracking tables", async () => {
    const db = fakeDb(() => [{ tablename: "invoices" }, { tablename: "schema_migrations" }, { tablename: "tenants" }]);
    expect(await discoverTables(db)).toEqual(["invoices", "tenants"]);
    expect(db.statements[0]).toMatch(/schemaname = 'public'/);
  });

  it("counts each table with a quoted identifier", async () => {
    const db = fakeDb(() => [{ n: 3 }]);
    expect(await countRows(db, ["invoices", 'we"ird'])).toEqual({ invoices: 3, 'we"ird': 3 });
    expect(db.statements).toContain('SELECT count(*)::int AS n FROM public."we""ird"');
  });

  it("empties every listed table in one statement inside one transaction", async () => {
    const db = fakeDb(() => [{ n: 0 }]);
    const after = await truncateAll(db, ["invoices", "tenants"]);
    expect(db.transactions).toHaveLength(1);
    expect(db.transactions[0]).toEqual(['TRUNCATE public."invoices", public."tenants" RESTART IDENTITY CASCADE']);
    expect(after).toEqual({ invoices: 0, tenants: 0 });
  });

  it("refuses to run with nothing to wipe", async () => {
    await expect(truncateAll(fakeDb(), [])).rejects.toThrow("No tables to wipe.");
  });

  it("judges the lockdown only by RLS and Data API privileges", () => {
    expect(lockdownHolds({ rlsOff: [], grants: [] })).toBe(true);
    expect(lockdownHolds({ rlsOff: ["invoices"], grants: [] })).toBe(false);
    expect(lockdownHolds({ rlsOff: [], grants: ["anon: table invoices"] })).toBe(false);
  });
});
