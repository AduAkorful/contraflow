import { describe, expect, it } from "vitest";
import { starterGrantToast } from "../src/attest/grantCopy";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("starterGrantToast", () => {
  it("says test USDC on testnet and omits test on mainnet", () => {
    expect(starterGrantToast("0.05", ARC_TESTNET_CHAIN_ID)).toBe(
      "We sent you 0.05 test USDC to cover network fees.",
    );
    expect(starterGrantToast("0.05", ARC_MAINNET_CHAIN_ID)).toBe(
      "We sent you 0.05 USDC to cover network fees.",
    );
  });
});

describe("migration 012", () => {
  it("enables row-level security on invoice_links", () => {
    const sql = readFileSync(resolve(__dirname, "../src/db/migrations/012_invoice_links.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS invoice_links/);
    expect(sql).toMatch(/ALTER TABLE invoice_links ENABLE ROW LEVEL SECURITY/);
  });
});
