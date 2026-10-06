import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  completeFromEffect: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../src/api/deps", () => ({
  apiDeps: () => ({ store: {} }),
  idempotency: { claim: mocks.claim, complete: mocks.complete, completeFromEffect: mocks.completeFromEffect },
}));
vi.mock("../src/ratelimit/limiter", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("../src/api/auth", () => ({
  authenticate: vi.fn(async () => ({ tenantId: `0x${"ab".repeat(32)}`, mode: "test", chainId: 5042002 })),
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message);
    }
  },
}));

import { ApiError } from "../src/api/auth";
import { route } from "../src/api/http";

function post(): Request {
  return new Request("https://app.test/api/v1/permissions", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "permission-1" },
    body: "{}",
  });
}

describe("API idempotency failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ kind: "new", leaseToken: "lease-1" });
    mocks.complete.mockResolvedValue(undefined);
    mocks.completeFromEffect.mockResolvedValue(undefined);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  });

  it("retains the reservation after an ambiguous unexpected failure", async () => {
    const handler = route(async () => {
      throw new Error("database response was lost after mutation");
    });

    const response = await handler(post(), { params: Promise.resolve({}) });

    expect(response.status).toBe(500);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("stores a deterministic client error for replay", async () => {
    const handler = route(async () => {
      throw new ApiError(422, "rejected", "Invalid permission.");
    }, { recoverStaleIdempotency: true });

    const response = await handler(post(), { params: Promise.resolve({}) });

    expect(response.status).toBe(422);
    expect(mocks.complete).toHaveBeenCalledWith(
      `0x${"ab".repeat(32)}`,
      "permission-1",
      422,
      { error: { code: "rejected", message: "Invalid permission." } },
      "lease-1",
    );
    expect(mocks.claim).toHaveBeenCalledWith(
      `0x${"ab".repeat(32)}`,
      "permission-1",
      expect.any(String),
      true,
    );
  });

  it("reports server errors with an idempotency key as uncertain outcomes", async () => {
    const handler = route(async () => {
      throw new ApiError(503, "unavailable", "A follow-up service failed.");
    });

    const response = await handler(post(), { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: {
        code: "internal_error",
        message: "The request result is uncertain. Keep this Idempotency-Key and contact support before retrying with a new key.",
      },
    });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("returns 409 while a key is in progress if no effect is found", async () => {
    mocks.claim.mockResolvedValue({ kind: "in_progress" });
    const handler = route(async () => ({ status: 201, body: { ok: true } }), {
      recoverFromEffect: async () => null,
    });
    const response = await handler(post(), { params: Promise.resolve({}) });
    expect(response.status).toBe(409);
    expect(mocks.completeFromEffect).not.toHaveBeenCalled();
  });

  it("replays an existing effect without re-running the handler", async () => {
    mocks.claim.mockResolvedValue({ kind: "in_progress" });
    const run = vi.fn(async () => ({ status: 201, body: { ok: true } }));
    const handler = route(run, {
      recoverFromEffect: async () => ({ status: 201, body: { proposal: { token: "tok123" } } }),
    });
    const response = await handler(post(), { params: Promise.resolve({}) });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ proposal: { token: "tok123" } });
    expect(run).not.toHaveBeenCalled();
    expect(mocks.completeFromEffect).toHaveBeenCalled();
  });
});
