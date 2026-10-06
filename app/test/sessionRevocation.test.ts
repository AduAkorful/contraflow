import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const exists = vi.fn();
vi.mock("../src/upstash/client", () => ({ redis: () => ({ set, exists }) }));

const cookieJar = new Map<string, string>();
const deleted: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    delete: (name: string) => {
      deleted.push(name);
      cookieJar.delete(name);
    },
    set: vi.fn(),
  }),
}));
// `cache` only matters inside a Next request; here every call should run fresh.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const ADDRESS = "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C" as const;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-do-not-use-in-production";
});

const { createSessionToken } = await import("../src/session/cookie");
const { isSessionRevoked, revokeSession } = await import("../src/session/revocation");
const { getSession, SESSION_COOKIE_NAME } = await import("../src/session/getSession");
const { signOut } = await import("../src/app/app/siwe/actions");

beforeEach(() => {
  set.mockReset();
  exists.mockReset();
  cookieJar.clear();
  deleted.length = 0;
});

describe("revocation list", () => {
  it("stores a hash of the token, not the token, until it would have expired", async () => {
    const token = createSessionToken(ADDRESS);
    await revokeSession(token, 1_000_000 + 90_000, 1_000_000);
    const [key, value, options] = set.mock.calls[0]!;
    expect(key).toMatch(/^session:revoked:[0-9a-f]{64}$/);
    expect(key).not.toContain(token);
    expect(value).toBe("1");
    expect(options).toEqual({ ex: 90 });
  });

  it("writes nothing for a token that has already expired", async () => {
    await revokeSession("x", 1_000, 5_000);
    expect(set).not.toHaveBeenCalled();
  });

  it("reads the same key it wrote", async () => {
    const token = createSessionToken(ADDRESS);
    await revokeSession(token, Date.now() + 60_000);
    exists.mockResolvedValue(1);
    expect(await isSessionRevoked(token)).toBe(true);
    expect(exists).toHaveBeenCalledWith(set.mock.calls[0]![0]);
    exists.mockResolvedValue(0);
    expect(await isSessionRevoked(token)).toBe(false);
  });
});

describe("getSession", () => {
  it("returns the session for a valid, unrevoked cookie", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, createSessionToken(ADDRESS));
    exists.mockResolvedValue(0);
    expect((await getSession())?.address).toBe(ADDRESS);
  });

  it("returns null once the cookie has been signed out", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, createSessionToken(ADDRESS));
    exists.mockResolvedValue(1);
    expect(await getSession()).toBeNull();
  });

  it("fails closed when the revocation list can't be read", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, createSessionToken(ADDRESS));
    exists.mockRejectedValue(new Error("redis down"));
    expect(await getSession()).toBeNull();
  });

  it("doesn't consult the list for a forged or missing cookie", async () => {
    expect(await getSession()).toBeNull();
    cookieJar.set(SESSION_COOKIE_NAME, "forged.value");
    expect(await getSession()).toBeNull();
    expect(exists).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("revokes the session and then clears the cookie", async () => {
    const token = createSessionToken(ADDRESS);
    cookieJar.set(SESSION_COOKIE_NAME, token);
    set.mockResolvedValue("OK");
    expect(await signOut()).toEqual({ ok: true });
    expect(set).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual([SESSION_COOKIE_NAME]);
  });

  it("keeps the cookie and says so when revocation can't be recorded", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, createSessionToken(ADDRESS));
    set.mockRejectedValue(new Error("redis down"));
    const result = await signOut();
    expect(result.ok).toBe(false);
    expect(deleted).toEqual([]);
    expect(cookieJar.has(SESSION_COOKIE_NAME)).toBe(true);
  });

  it("just clears a cookie that isn't a valid session", async () => {
    cookieJar.set(SESSION_COOKIE_NAME, "garbage");
    expect(await signOut()).toEqual({ ok: true });
    expect(set).not.toHaveBeenCalled();
    expect(deleted).toEqual([SESSION_COOKIE_NAME]);
  });
});
