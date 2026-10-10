import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordUsage: vi.fn(),
  afterTasks: [] as (() => Promise<void> | void)[],
  checkRateLimit: vi.fn(),
  authenticate: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (fn: () => Promise<void> | void) => mocks.afterTasks.push(fn) }));
vi.mock("../src/api/deps", () => ({
  apiDeps: () => ({ store: {}, recordUsage: mocks.recordUsage }),
  idempotency: { claim: vi.fn(), complete: vi.fn(), completeFromEffect: vi.fn() },
}));
vi.mock("../src/ratelimit/limiter", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("../src/api/webhookRunner", () => ({ runWebhookPipelineQuietly: vi.fn() }));
vi.mock("../src/api/auth", () => ({
  authenticate: mocks.authenticate,
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message);
    }
  },
}));

import { ApiError } from "../src/api/auth";
import { createObligationProposal, getTenant } from "../src/api/handlers";
import { route } from "../src/api/http";
import { attributedParty, parseUsageRange, permissionState, statusClassOf } from "../src/api/usage";

const TENANT = `0x${"ab".repeat(32)}`;
const PARTY = "0x4e71B023324BB2F66Fe3E4153BC4b40Fb913b24F";

async function flush() {
  for (const task of mocks.afterTasks.splice(0)) await task();
}

function call(handler: ReturnType<typeof route>, url: string, init?: RequestInit, params: Record<string, string> = {}) {
  return handler(new Request(url, init), { params: Promise.resolve(params) });
}

describe("usage counting at the API wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterTasks.length = 0;
    mocks.recordUsage.mockResolvedValue(undefined);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 599, count: 1, reset: 1_800_000_060 });
    mocks.authenticate.mockResolvedValue({ tenantId: TENANT, mode: "test", chainId: 5042002 });
  });

  it("records the operation, status class and key for a successful call", async () => {
    const handler = route(async () => ({ status: 200, body: {} }));
    // an anonymous function has no operation entry
    const res = await call(handler, "https://app.test/api/v1/tenant", { headers: { authorization: "Bearer cfk_test_abc" } });
    await flush();
    expect(res.status).toBe(200);
    expect(mocks.recordUsage).toHaveBeenCalledTimes(1);
    const rec = (mocks.recordUsage.mock.calls[0] as [Record<string, unknown>])[0];
    expect(rec).toMatchObject({ tenantId: TENANT, operation: "unknown", statusClass: "2xx", errorCode: "", party: "" });
    expect(rec.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the operation of a real handler", async () => {
    const handler = route(getTenant);
    mocks.authenticate.mockResolvedValue({ tenantId: TENANT, mode: "test", chainId: 5042002 });
    await call(handler, "https://app.test/api/v1/tenant");
    await flush();
    expect((mocks.recordUsage.mock.calls[0] as [Record<string, unknown>])[0].operation).toBe("getTenant");
  });

  it("attributes the party from the body and keeps the error code of a refusal", async () => {
    const handler = route(createObligationProposal);
    const res = await call(handler, "https://app.test/api/v1/obligations/proposals", {
      method: "POST",
      body: JSON.stringify({ party: PARTY }),
    });
    await flush();
    expect(res.status).toBeGreaterThanOrEqual(400);
    const rec = (mocks.recordUsage.mock.calls[0] as [Record<string, unknown>])[0];
    expect(rec.operation).toBe("createObligationProposal");
    expect(rec.statusClass).not.toBe("2xx");
    expect(typeof rec.errorCode).toBe("string");
  });

  it("does not attribute a 404 to the requested party", async () => {
    const handler = route(async () => {
      throw new ApiError(404, "not_found", "Not found.");
    });
    await call(handler, `https://app.test/api/v1/parties/${PARTY}/obligations`, undefined, { address: PARTY });
    await flush();
    expect((mocks.recordUsage.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({ party: "", statusClass: "4xx", errorCode: "not_found" });
  });

  it("attributes a refused request after the permission check to the party", async () => {
    const handler = route(async () => {
      throw new ApiError(422, "rejected", "Invalid.");
    });
    await call(handler, `https://app.test/api/v1/parties/${PARTY}/loops`, undefined, { address: PARTY });
    await flush();
    expect((mocks.recordUsage.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({ party: PARTY.toLowerCase(), errorCode: "rejected" });
  });

  it("counts nothing for an unauthenticated call", async () => {
    mocks.authenticate.mockRejectedValue(new ApiError(401, "unauthorized", "Missing or invalid API key."));
    const res = await call(route(async () => ({ status: 200, body: {} })), "https://app.test/api/v1/tenant");
    await flush();
    expect(res.status).toBe(401);
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("serves a route that receives no params object", async () => {
    const handler = route(async () => ({ status: 200, body: {} }));
    const res = await handler(new Request("https://app.test/api/v1/tenant"), { params: Promise.resolve(undefined as never) });
    await flush();
    expect(res.status).toBe(200);
  });

  it("never changes the response when the count fails", async () => {
    mocks.recordUsage.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(route(async () => ({ status: 200, body: { ok: true } })), "https://app.test/api/v1/tenant");
    await flush();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("usage helpers", () => {
  it("maps status codes to classes", () => {
    expect([statusClassOf(201), statusClassOf(404), statusClassOf(503)]).toEqual(["2xx", "4xx", "5xx"]);
  });

  it("drops the party for 401, 403 and 404 and lowercases otherwise", () => {
    expect(attributedParty(404, PARTY)).toBe("");
    expect(attributedParty(403, PARTY)).toBe("");
    expect(attributedParty(200, PARTY)).toBe(PARTY.toLowerCase());
    expect(attributedParty(200, "not-an-address")).toBe("");
    expect(attributedParty(200, null)).toBe("");
  });

  it("derives the permission state", () => {
    const now = 1_000_000n;
    expect(permissionState(null, now)).toBe("none");
    expect(permissionState({ scopes: 7, expiresAt: now + 100n, revoked: true }, now)).toBe("revoked");
    expect(permissionState({ scopes: 7, expiresAt: now - 1n, revoked: false }, now)).toBe("expired");
    expect(permissionState({ scopes: 7, expiresAt: now + 86_400n, revoked: false }, now)).toBe("expiring");
    expect(permissionState({ scopes: 7, expiresAt: now + 30n * 86_400n, revoked: false }, now)).toBe("live");
  });

  it("validates the date range", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(parseUsageRange(null, null, now)).toEqual({ ok: true, from: "2026-09-11", to: "2026-10-10" });
    expect(parseUsageRange("2026-10-12", null, now).ok).toBe(false);
    expect(parseUsageRange("2026-10-05", "2026-10-01", now).ok).toBe(false);
    expect(parseUsageRange("2026-06-01", "2026-10-10", now).ok).toBe(false);
    expect(parseUsageRange("2026-10-01", "2026-10-11", now).ok).toBe(false);
    expect(parseUsageRange("yesterday", null, now).ok).toBe(false);
  });
});
