import { describe, expect, it } from "vitest";
import { marketingFooterColumns, marketingMobileExtraLinks, marketingPrimaryLinks } from "../components/marketing/nav";
import { sourcifyLookupUrl } from "../src/site/sourcify";
import { GITHUB_REPO } from "../src/site/github";
import { addressesForChain, APP_CHAIN_ID } from "../src/contracts/addresses";

describe("marketing nav", () => {
  it("keeps one desktop primary set without Demo or open-source wording", () => {
    const labels = marketingPrimaryLinks({ href: "/docs", external: false }).map((l) => l.label);
    expect(labels).toEqual(["How it works", "Developers", "Pricing", "About"]);
    expect(labels.join(" ")).not.toMatch(/demo/i);
    expect(marketingFooterColumns().flatMap((c) => c.links.map((l) => l.label)).join(" ")).not.toMatch(/open source/i);
  });

  it("puts Verify in the mobile extras and points Developers at docs", () => {
    expect(marketingMobileExtraLinks().map((l) => l.label)).toEqual(["Features", "Verify", "Contact"]);
    expect(marketingPrimaryLinks({ href: "https://docs.example/", external: true })[1]).toMatchObject({
      label: "Developers",
      href: "https://docs.example/",
      external: true,
    });
  });

  it("names GitHub as source, not a licence grant", () => {
    const github = marketingFooterColumns().flatMap((c) => c.links).find((l) => l.href === GITHUB_REPO);
    expect(github?.label).toBe("Source on GitHub");
  });
});

describe("Sourcify lookup", () => {
  it("points at the lookup hash for a deployed contract, not a guessed match path", () => {
    const registry = addressesForChain(APP_CHAIN_ID).registry;
    expect(sourcifyLookupUrl(registry)).toBe(`https://sourcify.dev/#/lookup/${registry}`);
  });
});
