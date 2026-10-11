import { describe, expect, it } from "vitest";
import { inApiBucket, reportLimitHit, serviceRateLimitKey, withApiLimitBucket } from "../src/api/limitBucket";

describe("limit bucket", () => {
  it("keys API budgets by tenant and tells the request which budget tripped", async () => {
    let seen: { limit: number; reset: number } | null = null;
    await withApiLimitBucket(
      "0xAB",
      async () => {
        expect(inApiBucket()).toBe(true);
        expect(serviceRateLimitKey("obligations", "write", "0xParty")).toBe("obligations:write:tenant:0xab:0xparty");
        reportLimitHit({ limit: 120, reset: 1_800_000_600 });
      },
      (hit) => (seen = hit),
    );
    expect(seen).toEqual({ limit: 120, reset: 1_800_000_600 });
  });

  it("uses the web bucket outside an API request, and reporting does nothing", () => {
    expect(inApiBucket()).toBe(false);
    expect(serviceRateLimitKey("obligations", "write", "0xParty")).toBe("obligations:write:web:0xparty");
    expect(() => reportLimitHit({ limit: 20, reset: 1 })).not.toThrow();
  });
});
