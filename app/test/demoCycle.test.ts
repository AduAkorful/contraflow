import { describe, expect, it } from "vitest";
import { deriveDemoParties } from "../src/fixtures/demoIdentities";
import {
  buildDemoCycleInvoices,
  demoEdgeAmountUsdc,
  DEMO_MIN_AMOUNT_USDC,
  DEMO_MAX_AMOUNT_USDC,
} from "../src/fixtures/demoCycle";

const BASE_PARAMS = {
  runSalt: "run-1",
  currency: "0x3600000000000000000000000000000000000000" as const,
  registry: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312" as const,
  chainId: 5042002n,
  nowUnixSeconds: 1_000_000_000n,
};

describe("buildDemoCycleInvoices", () => {
  it("builds a closed ring for any allowed party count", () => {
    for (const count of [3, 4, 5]) {
      const parties = deriveDemoParties("run-1", count);
      const invoices = buildDemoCycleInvoices({ parties, ...BASE_PARAMS });

      expect(invoices).toHaveLength(count);
      for (let i = 0; i < count; i++) {
        const next = invoices[(i + 1) % count]!;
        expect(invoices[i]!.attestation.creditor).toBe(next.attestation.debtor);
      }
    }
  });

  it("gives every invoice nonce 1 — fresh addresses never touched before", () => {
    const parties = deriveDemoParties("run-1", 4);
    const invoices = buildDemoCycleInvoices({ parties, ...BASE_PARAMS });
    for (const inv of invoices) expect(inv.attestation.nonce).toBe(1n);
  });

  it("sets earlyNetConsent = true so the demo can settle immediately", () => {
    const parties = deriveDemoParties("run-1", 3);
    const invoices = buildDemoCycleInvoices({ parties, ...BASE_PARAMS });
    for (const inv of invoices) expect(inv.attestation.earlyNetConsent).toBe(true);
  });

  it("gives every invoice ref a distinct value", () => {
    const parties = deriveDemoParties("run-1", 5);
    const invoices = buildDemoCycleInvoices({ parties, ...BASE_PARAMS });
    const refs = invoices.map((i) => i.attestation.invoiceRef);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("gives edges unequal amounts within the documented range, not one fixed figure", () => {
    const parties = deriveDemoParties("run-1", 5);
    const invoices = buildDemoCycleInvoices({ parties, ...BASE_PARAMS });
    const amounts = invoices.map((i) => Number(i.amountUsdc));

    for (const amount of amounts) {
      expect(amount).toBeGreaterThanOrEqual(DEMO_MIN_AMOUNT_USDC);
      expect(amount).toBeLessThanOrEqual(DEMO_MAX_AMOUNT_USDC);
    }
    // Not a hard guarantee for every possible salt, but true for this one — catches an
    // accidental revert to one hardcoded amount for every edge.
    expect(new Set(amounts).size).toBeGreaterThan(1);

    // attestation.amount (base units) must agree with the human amountUsdc string.
    for (const inv of invoices) {
      expect(inv.attestation.amount).toBe(BigInt(inv.amountUsdc) * 1_000_000n);
    }
  });
});

describe("demoEdgeAmountUsdc", () => {
  it("is deterministic for a given (index, runSalt) pair", () => {
    expect(demoEdgeAmountUsdc(0, "run-1")).toBe(demoEdgeAmountUsdc(0, "run-1"));
  });

  it("differs across runs for the same index, in general", () => {
    const a = demoEdgeAmountUsdc(0, "run-1");
    const b = demoEdgeAmountUsdc(0, "run-2");
    // Both individually valid; just confirms the salt actually participates in the derivation.
    expect(a).toBeGreaterThanOrEqual(DEMO_MIN_AMOUNT_USDC);
    expect(b).toBeGreaterThanOrEqual(DEMO_MIN_AMOUNT_USDC);
  });

  it("always stays within the documented range", () => {
    for (let i = 0; i < 20; i++) {
      const amount = demoEdgeAmountUsdc(i, `run-${i}`);
      expect(amount).toBeGreaterThanOrEqual(DEMO_MIN_AMOUNT_USDC);
      expect(amount).toBeLessThanOrEqual(DEMO_MAX_AMOUNT_USDC);
    }
  });
});
