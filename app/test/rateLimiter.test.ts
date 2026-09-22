import { describe, expect, it, vi, beforeEach } from "vitest";

const incr = vi.fn();
const expire = vi.fn();
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({ incr, expire })),
}));

process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

const { checkRateLimit, incrementWindowCounter } = await import("../src/ratelimit/limiter");

describe("checkRateLimit / incrementWindowCounter", () => {
  beforeEach(() => {
    incr.mockReset();
    expire.mockReset();
  });

  it("allows requests under the limit", async () => {
    incr.mockResolvedValueOnce(1);
    const result = await checkRateLimit("key", 5, 60);
    expect(result).toEqual({ allowed: true, remaining: 4, count: 1 });
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("blocks requests once the limit is exceeded", async () => {
    incr.mockResolvedValueOnce(6);
    const result = await checkRateLimit("key", 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("only sets expiry on the first increment of a window, not every call", async () => {
    incr.mockResolvedValueOnce(2);
    await checkRateLimit("key", 5, 60);
    expect(expire).not.toHaveBeenCalled();
  });

  it("incrementWindowCounter returns the raw count", async () => {
    incr.mockResolvedValueOnce(3);
    const count = await incrementWindowCounter("key", 60);
    expect(count).toBe(3);
  });
});
