import { describe, expect, it } from "vitest";
import { PUBLISHED_DOCS_URL, docsNavLink, docsUrl } from "../src/site/docsUrl";
import { appNavItems, isNavActive } from "../components/app-shell/nav";

describe("docsUrl", () => {
  it("accepts only an https URL", () => {
    expect(docsUrl("https://docs.contraflow.example/")).toBe("https://docs.contraflow.example/");
    expect(docsUrl(" https://docs.contraflow.example ")).toBe("https://docs.contraflow.example/");
  });
  it("uses the published GitBook site when no override is set", () => {
    expect(docsUrl(undefined)).toBe(PUBLISHED_DOCS_URL);
    expect(docsNavLink(undefined)).toEqual({ href: PUBLISHED_DOCS_URL, external: true });
  });
  it.each(["", "   ", "http://docs.example", "javascript:alert(1)", "//docs.example", "docs.example", "not a url"])(
    "rejects %j",
    (value) => expect(docsUrl(value)).toBeNull(),
  );
});

describe("app nav Docs entry", () => {
  it("opens the published docs site", () => {
    const docs = appNavItems({ balance: true }).find((i) => i.label === "Docs");
    expect(docs).toMatchObject({ href: PUBLISHED_DOCS_URL, external: true });
  });
  it("opens the published URL in a new tab when set", () => {
    const docs = appNavItems({ balance: true, docs: { href: "https://docs.contraflow.example/", external: true } }).find(
      (i) => i.label === "Docs",
    );
    expect(docs).toMatchObject({ href: "https://docs.contraflow.example/", external: true });
    expect(isNavActive(docs!, "/app")).toBe(false);
    expect(docsNavLink("https://docs.contraflow.example/")).toEqual({
      href: "https://docs.contraflow.example/",
      external: true,
    });
  });
});
