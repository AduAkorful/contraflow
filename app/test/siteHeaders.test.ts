import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { DELETE, GET, PATCH, POST, PUT } from "../app/api/v1/[...path]/route";

describe("security headers", () => {
  it("apply to every path and forbid framing and sniffing", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    const headers = Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]));
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });
});

describe("unknown /api/v1 paths", () => {
  it.each([GET, POST, PUT, PATCH, DELETE])("answer 404 in the API's JSON error shape", async (handler) => {
    const res = handler();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "No such API endpoint." } });
  });
});
