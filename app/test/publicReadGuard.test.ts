import { beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimit = vi.fn();
const requestIp = vi.fn();
vi.mock("../src/ratelimit/limiter", () => ({ checkRateLimit }));
vi.mock("../src/ratelimit/requestIp", () => ({ requestIp }));

const { guardPublicRead } = await import("../src/ratelimit/publicReadGuard");

describe("guardPublicRead", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requestIp.mockResolvedValue("203.0.113.12");
    checkRateLimit.mockResolvedValue({ allowed: true });
  });

  it("uses route and IP scoped rate limit keys", async () => {
    expect(await guardPublicRead("history")).toEqual({ allowed: true });
    expect(checkRateLimit).toHaveBeenCalledWith("public-read:history:203.0.113.12", 10, 60);
  });

  it("rejects when the request budget is exhausted", async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false });
    expect(await guardPublicRead("invoice-freshness")).toMatchObject({ allowed: false });
  });

  it("fails closed when the limiter or IP lookup is unavailable", async () => {
    checkRateLimit.mockRejectedValueOnce(new Error("Redis unavailable"));
    expect(await guardPublicRead("history")).toMatchObject({ allowed: false });
  });
});
