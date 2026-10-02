import { describe, expect, it } from "vitest";
import { invoiceViewerRole, isInvoiceCounterparty } from "../src/attest/viewer";

const invoice = {
  debtor: "0x1111111111111111111111111111111111111111" as const,
  creditor: "0x2222222222222222222222222222222222222222" as const,
};
const unrelated = "0x3333333333333333333333333333333333333333" as const;

describe("invoice link viewer identity", () => {
  it("assigns roles only to the authenticated invoice parties", () => {
    expect(invoiceViewerRole(invoice, invoice.debtor)).toBe("debtor");
    expect(invoiceViewerRole(invoice, invoice.creditor.toUpperCase().replace("0X", "0x"))).toBe("creditor");
    expect(invoiceViewerRole(invoice, unrelated)).toBeNull();
    expect(invoiceViewerRole(invoice, null)).toBeNull();
  });

  it("allows only the expected counterparty with the same session and wallet", () => {
    expect(isInvoiceCounterparty(invoice, "debtor", invoice.creditor, invoice.creditor)).toBe(true);
    expect(isInvoiceCounterparty(invoice, "debtor", invoice.debtor, invoice.debtor)).toBe(false);
    expect(isInvoiceCounterparty(invoice, "debtor", unrelated, unrelated)).toBe(false);
    expect(isInvoiceCounterparty(invoice, "debtor", invoice.creditor, invoice.debtor)).toBe(false);
    expect(isInvoiceCounterparty(invoice, "debtor", invoice.creditor, undefined)).toBe(false);
  });
});
