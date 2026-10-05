import { describe, expect, it } from "vitest";
import { docsUrl } from "../src/site/docsUrl";
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
  it("is absent without a docs URL and external with one", () => {
    expect(appNavItems({ balance: true }).map((i) => i.label)).not.toContain("Docs");
    const docs = appNavItems({ balance: true, docsUrl: "https://docs.contraflow.example/" }).find((i) => i.label === "Docs");
    expect(docs).toMatchObject({ href: "https://docs.contraflow.example/", external: true });
  });
  it("is never marked active", () => {
    const docs = appNavItems({ balance: false, docsUrl: "https://docs.contraflow.example/" }).find((i) => i.label === "Docs")!;
    expect(isNavActive(docs, "/app")).toBe(false);
  });
});
