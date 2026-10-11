import { describe, expect, it } from "vitest";
import { MAX_INVOICE_USDC, parseUsdcAmount, UsdcAmountError } from "../src/attest/amount";
import { obligationDocumentProblem, OBLIGATION_DOCUMENT_FORMAT } from "../src/netting/document";

const PARTY_A = "0x1111111111111111111111111111111111111111";
const PARTY_B = "0x2222222222222222222222222222222222222222";

describe("amount limits", () => {
  it("refuses an invoice amount above the limit and accepts the limit itself", () => {
    expect(() => parseUsdcAmount("999999999999999999999999999")).toThrow(UsdcAmountError);
    expect(() => parseUsdcAmount((MAX_INVOICE_USDC + 1n).toString())).toThrow(/too large/);
    expect(parseUsdcAmount(MAX_INVOICE_USDC.toString())).toBe(MAX_INVOICE_USDC * 1_000_000n);
  });

  it("refuses an obligation document amount above the limit", () => {
    const doc = {
      format: OBLIGATION_DOCUMENT_FORMAT,
      description: "Consulting",
      debtor: PARTY_A,
      creditor: PARTY_B,
      currency: "USD",
      amount: "999999999999999999999999999",
      maturity: "2026-12-31",
      earlyNetConsent: true,
    } as const;
    expect(obligationDocumentProblem({ ...doc })).toMatch(/too large/);
    expect(obligationDocumentProblem({ ...doc, amount: "1000.00" })).toBeNull();
  });
});
