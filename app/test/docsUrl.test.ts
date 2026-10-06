import { describe, expect, it } from "vitest";
import { docsNavLink, docsUrl } from "../src/site/docsUrl";
import { appNavItems, isNavActive } from "../components/app-shell/nav";

describe("docsUrl", () => {
  it("accepts only an https URL", () => {
    expect(docsUrl("https://docs.contraflow.example/")).toBe("https://docs.contraflow.example/");
    expect(docsUrl(" https://docs.contraflow.example ")).toBe("https://docs.contraflow.example/");
  });
  it.each([undefined, "", "   ", "http://docs.example", "javascript:alert(1)", "//docs.example", "docs.example", "not a url"])(
    "returns null for %j",
    (value) => expect(docsUrl(value)).toBeNull(),
  );
});

describe("app nav Docs entry", () => {
  it("defaults to the in-app docs page", () => {
    const docs = appNavItems({ balance: true }).find((i) => i.label === "Docs");
    expect(docs).toMatchObject({ href: "/docs", external: false });
    expect(docsNavLink(undefined)).toEqual({ href: "/docs", external: false });
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
