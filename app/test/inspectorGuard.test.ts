import { describe, expect, it, vi, beforeEach } from "vitest";

const headerValues = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => headerValues.get(name) ?? null }),
}));

const checkRateLimit = vi.fn();
vi.mock("../src/ratelimit/limiter", () => ({ checkRateLimit }));

const { guardInspectorRequest, SIGNALS_UNAVAILABLE } = await import("../src/inspector/requestGuard");

describe("guardInspectorRequest", () => {
  beforeEach(() => {
    headerValues.clear();
    checkRateLimit.mockReset();
  });

  it("keys the limit by scope and the first forwarded IP", async () => {
    headerValues.set("x-forwarded-for", "203.0.113.7, 10.0.0.1");
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 19, count: 1 });

    expect(await guardInspectorRequest("cycle")).toEqual({ allowed: true });
    expect(checkRateLimit).toHaveBeenCalledWith("inspector:cycle:203.0.113.7", 20, 60);
  });

  it("rejects once the window's limit is exceeded", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, count: 21 });
    expect(await guardInspectorRequest("address")).toEqual({
      allowed: false,
      error: "Too many lookups. Try again in a minute.",
    });
  });

  it("fails closed when the limiter itself is unreachable", async () => {
    checkRateLimit.mockRejectedValue(new Error("ENETUNREACH"));
    expect(await guardInspectorRequest("address")).toEqual({ allowed: false, error: SIGNALS_UNAVAILABLE });
  });
});
