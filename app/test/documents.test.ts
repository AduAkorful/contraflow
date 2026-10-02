import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db/client", () => ({ sql: () => query, withDbRetry: (fn: () => Promise<unknown>) => fn() }));

import { insertInvoiceDocumentIfAbsent, type UpsertInvoiceDocumentInput } from "../src/db/documents";

const input: UpsertInvoiceDocumentInput = {
  invoiceRef: "0xabc",
  description: "Services",
  debtor: "0x1111111111111111111111111111111111111111",
  creditor: "0x2222222222222222222222222222222222222222",
  amountUsdc: "1.00",
  maturity: "2026-10-01",
  createdBy: "0x1111111111111111111111111111111111111111",
};

describe("insertInvoiceDocumentIfAbsent", () => {
  beforeEach(() => query.mockReset());

  it("inserts new content", async () => {
    query.mockResolvedValueOnce([{ invoice_ref: input.invoiceRef }]);
    await expect(insertInvoiceDocumentIfAbsent(input)).resolves.toBe("created");
    expect(query.mock.calls[0]![0].join(" ")).toContain("ON CONFLICT (invoice_ref) DO NOTHING");
  });

  it("treats an identical retry as idempotent", async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      description: input.description,
      debtor: input.debtor.toUpperCase().replace("0X", "0x"),
      creditor: input.creditor,
      amount_usdc: input.amountUsdc,
      maturity: input.maturity,
    }]);
    await expect(insertInvoiceDocumentIfAbsent(input)).resolves.toBe("identical");
  });

  it("refuses to overwrite existing terms under the same reference", async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      description: "Different terms",
      debtor: input.debtor,
      creditor: input.creditor,
      amount_usdc: input.amountUsdc,
      maturity: input.maturity,
    }]);
    await expect(insertInvoiceDocumentIfAbsent(input)).resolves.toBe("conflict");
  });
});
