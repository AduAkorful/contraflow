import { describe, expect, it } from "vitest";
import { canonicalizeDocument, hashInvoiceDocument, type CanonicalInvoiceDocument } from "../src/attest/document";

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
