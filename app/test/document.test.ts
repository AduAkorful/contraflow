import { describe, expect, it } from "vitest";
import { canonicalizeDocument, hashInvoiceDocument, type CanonicalInvoiceDocument } from "../src/attest/document";
import { formatUsdcAmount, parseUsdcAmount } from "../src/attest/amount";
import { invoiceDocumentProblem } from "../src/attest/document";

const DOCUMENT: CanonicalInvoiceDocument = {
  description: "Invoice #4521 — Q3 consulting services",
  debtor: "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C",
  creditor: "0xD98CC80747e67B357EA914614C213209c877Be04",
  amountUsdc: "1050.00",
  maturity: "2026-10-21",
};

describe("canonicalizeDocument / hashInvoiceDocument", () => {
  it("is deterministic regardless of input key order", () => {
    const reordered: CanonicalInvoiceDocument = {
      maturity: DOCUMENT.maturity,
      amountUsdc: DOCUMENT.amountUsdc,
      creditor: DOCUMENT.creditor,
      debtor: DOCUMENT.debtor,
      description: DOCUMENT.description,
    };
    expect(canonicalizeDocument(DOCUMENT)).toEqual(canonicalizeDocument(reordered));
    expect(hashInvoiceDocument(DOCUMENT)).toEqual(hashInvoiceDocument(reordered));
  });

  it("normalizes address case and trims description whitespace", () => {
    const withCasingAndWhitespace: CanonicalInvoiceDocument = {
      ...DOCUMENT,
      debtor: DOCUMENT.debtor.toUpperCase() as `0x${string}`,
      creditor: DOCUMENT.creditor.toLowerCase() as `0x${string}`,
      description: `  ${DOCUMENT.description}  `,
    };
    expect(hashInvoiceDocument(DOCUMENT)).toEqual(hashInvoiceDocument(withCasingAndWhitespace));
  });

  it("changes the hash when any field changes", () => {
    const base = hashInvoiceDocument(DOCUMENT);
    expect(hashInvoiceDocument({ ...DOCUMENT, description: "Different description" })).not.toEqual(base);
    expect(hashInvoiceDocument({ ...DOCUMENT, amountUsdc: "1050.01" })).not.toEqual(base);
    expect(hashInvoiceDocument({ ...DOCUMENT, maturity: "2026-10-22" })).not.toEqual(base);
    expect(hashInvoiceDocument({ ...DOCUMENT, debtor: DOCUMENT.creditor })).not.toEqual(base);
  });

  it("matches a fixed known-vector hash (regression guard against an algorithm change)", () => {
    expect(hashInvoiceDocument(DOCUMENT)).toEqual(
      "0x974fda6113afa80edc454b1eb0cc8fe72abd43df3021204dbb517b3b009329d2",
    );
  });

  it("produces a 32-byte hex hash", () => {
    const hash = hashInvoiceDocument(DOCUMENT);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("USDC amount parsing and formatting", () => {
  it.each([
    ["1.00", 1_000_000n, "1.00"],
    ["1.005", 1_005_000n, "1.005"],
    ["0.000001", 1n, "0.000001"],
    ["9007199254.740993", 9_007_199_254_740_993n, "9007199254.740993"],
  ])("round-trips %s exactly", (input, units, formatted) => {
    expect(parseUsdcAmount(input)).toBe(units);
    expect(formatUsdcAmount(units)).toBe(formatted);
    expect(parseUsdcAmount(formatted)).toBe(units);
  });

  it.each(["0", "0.000000", "1e3", ".5", "-1", "1.0000001", "1."]) (
    "rejects invalid amount %s",
    (input) => expect(() => parseUsdcAmount(input)).toThrow(),
  );

  it("rejects values above uint256", () => {
    expect(() => parseUsdcAmount("115792089237316195423570985008687907853269984665640564039457584007913129639936"))
      .toThrow(/uint256/i);
  });
});

describe("canonical invoice document validation", () => {
  const doc = {
    description: "Consulting services",
    debtor: "0x1111111111111111111111111111111111111111" as const,
    creditor: "0x2222222222222222222222222222222222222222" as const,
    amountUsdc: "1.00",
    maturity: "2026-10-01",
  };

  it("accepts a canonical document", () => {
    expect(invoiceDocumentProblem(doc)).toBeNull();
  });

  it.each([
    [{ ...doc, description: "  Consulting services " }, "Invoice description must be non-empty and trimmed"],
    [{ ...doc, debtor: doc.creditor }, "Invoice parties must be different"],
    [{ ...doc, amountUsdc: "1.0" }, "Invoice amount must use canonical USDC precision"],
    [{ ...doc, amountUsdc: "1e3" }, "Invoice amount is invalid"],
    [{ ...doc, maturity: "2026-02-30" }, "Invoice maturity is invalid"],
  ])("rejects non-canonical document terms", (candidate, message) => {
    expect(invoiceDocumentProblem(candidate as typeof doc)).toBe(message);
  });
});
