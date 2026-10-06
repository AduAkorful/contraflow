import { describe, expect, it } from "vitest";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import nextConfig from "../next.config";

const HOST = "contraflow.vercel.app";

describe("robots and sitemap", () => {
  it("indexes marketing pages plus demo and verify, and keeps the rest of /app out", () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = HOST;
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule?.allow).toEqual(expect.arrayContaining(["/", "/app/demo", "/app/verify"]));
    expect(rule?.disallow).toEqual(expect.arrayContaining(["/app/", "/api/"]));
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`https://${HOST}/`);
    expect(urls).not.toContain(`https://${HOST}/docs`);
    expect(urls).toContain(`https://${HOST}/app/demo`);
    expect(urls).toContain(`https://${HOST}/app/verify`);
    expect(urls.some((url) => url.includes("/app/history"))).toBe(false);
  });

  it("omits absolute urls when the domain is local", () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = "localhost:3000";
    expect(sitemap()).toEqual([]);
    expect(robots().sitemap).toBeUndefined();
  });
});

describe("public redirects", () => {
  it("sends /demo to the product demo", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({ source: "/demo", destination: "/app/demo", permanent: false });
    expect(redirects).toContainEqual({
      source: "/docs",
      destination: "https://aduakorful.gitbook.io/contraflow-docs",
      permanent: false,
    });
  });
});
