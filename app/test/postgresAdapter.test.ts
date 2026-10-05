import { describe, expect, it, vi } from "vitest";
import { buildPoolConfig, createDb } from "../src/db/postgres";
import { isDbNotReachedError, withDbRetry } from "../src/db/client";

describe("buildPoolConfig", () => {
  const supabase = "postgresql://postgres.abcd:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

  it("verifies a Supabase host against the pinned root and never skips verification", () => {
    const config = buildPoolConfig(supabase);
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
    expect((config.ssl as { ca: string }).ca).toContain("BEGIN CERTIFICATE");
  });

  it("also pins the root for the direct and dedicated-pooler hosts", () => {
    expect(buildPoolConfig("postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres").ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("drops sslmode from the URL so it can't override the verification", () => {
    const config = buildPoolConfig(`${supabase}?sslmode=disable&application_name=contraflow`);
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.connectionString).toContain("application_name=contraflow");
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("uses no TLS only for a database on this machine", () => {
    for (const host of ["localhost", "127.0.0.1"]) {
      expect(buildPoolConfig(`postgresql://u:p@${host}:5432/db`).ssl).toBeUndefined();
    }
  });

  it("verifies any other host against the system trust store", () => {
    const config = buildPoolConfig("postgresql://u:p@db.example.com:5432/db?sslmode=disable");
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("keeps the pool to one connection with bounded waits, as a serverless function should", () => {
    const config = buildPoolConfig(supabase);
    expect(config.max).toBe(1);
    expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(config.idleTimeoutMillis).toBeGreaterThan(0);
    expect(config.query_timeout).toBeGreaterThan(0);
  });

  it("rejects a value that isn't a URL", () => {
    expect(() => buildPoolConfig("not a url")).toThrow();
  });
});

describe("tagged-template queries", () => {
  const db = createDb("postgresql://u:p@127.0.0.1:1/db");

  it("number placeholders in order and keep the values separate from the text", () => {
    const owner = "'; DROP TABLE x; --";
    const q = db`SELECT * FROM t WHERE a = ${owner} AND b = ${2} AND c = ${null}`;
    expect(q.text).toBe("SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3");
    expect(q.values).toEqual([owner, 2, null]);
    expect(q.text).not.toContain("DROP");
  });

  it("db.query takes explicit text and values", () => {
    const q = db.query("SELECT $1::int", [7]);
    expect(q.text).toBe("SELECT $1::int");
    expect(q.values).toEqual([7]);
  });

  it("is a full promise, so callers can chain catch and finally", () => {
    expect(db`SELECT 1`).toBeInstanceOf(Object);
    expect(typeof db`SELECT 1`.catch).toBe("function");
    expect(typeof db`SELECT 1`.finally).toBe("function");
  });
});

describe("retry classification", () => {
  const coded = (code: string) => Object.assign(new Error("boom"), { code });

  it.each(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "57P03", "53300"])(
    "retries %s, which means the database was never reached",
    (code) => expect(isDbNotReachedError(coded(code))).toBe(true),
  );

  it("retries the pool's own connection timeout", () => {
    expect(isDbNotReachedError(new Error("timeout exceeded when trying to connect"))).toBe(true);
  });

  it.each(["ECONNRESET", "57014", "23505", "42601", "40001"])(
    "doesn't retry %s: the statement may have run, or it will fail the same way",
    (code) => expect(isDbNotReachedError(coded(code))).toBe(false),
  );

  it("doesn't retry something that isn't an error", () => {
    expect(isDbNotReachedError("ETIMEDOUT")).toBe(false);
  });

  it("retries a not-reached error and then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(coded("ETIMEDOUT")).mockResolvedValueOnce("ok");
    await expect(withDbRetry(fn, 3)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never retries a write that may have committed", async () => {
    const fn = vi.fn().mockRejectedValue(coded("ECONNRESET"));
    await expect(withDbRetry(fn, 3)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
