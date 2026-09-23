/// Read/write helpers for `invoice_documents`. Mirrors `invoices.ts`'s own shape
/// (`withDbRetry` wrapper, row-mapping function) rather than
/// introducing a new pattern. Access control (only the two named parties may read or write a
/// given document) lives in the Server Actions that call these, not here — this module is a
/// plain data-access layer, same division of responsibility as `invoices.ts`.

import { sql, withDbRetry } from "./client";

export interface InvoiceDocumentRow {
  invoiceRef: string;
  description: string;
  debtor: string;
  creditor: string;
  amountUsdc: string;
  maturity: string;
  createdBy: string;
}

function toInvoiceDocumentRow(r: Record<string, unknown>): InvoiceDocumentRow {
  return {
    invoiceRef: r.invoice_ref as string,
    description: r.description as string,
    debtor: r.debtor as string,
    creditor: r.creditor as string,
    amountUsdc: r.amount_usdc as string,
    maturity: r.maturity as string,
    createdBy: r.created_by as string,
  };
}

export interface UpsertInvoiceDocumentInput {
  invoiceRef: string;
  description: string;
  debtor: string;
  creditor: string;
  amountUsdc: string;
  maturity: string;
  createdBy: string;
}

export async function upsertInvoiceDocument(input: UpsertInvoiceDocumentInput): Promise<void> {
  await withDbRetry(async () => {
    const db = sql();
    await db`
      INSERT INTO invoice_documents (invoice_ref, description, debtor, creditor, amount_usdc, maturity, created_by)
      VALUES (${input.invoiceRef}, ${input.description}, ${input.debtor}, ${input.creditor}, ${input.amountUsdc}, ${input.maturity}, ${input.createdBy})
      ON CONFLICT (invoice_ref) DO UPDATE SET
        description = EXCLUDED.description,
        debtor = EXCLUDED.debtor,
        creditor = EXCLUDED.creditor,
        amount_usdc = EXCLUDED.amount_usdc,
        maturity = EXCLUDED.maturity
    `;
  });
}

export async function getInvoiceDocumentByRef(invoiceRef: string): Promise<InvoiceDocumentRow | null> {
  return withDbRetry(async () => {
    const db = sql();
    const rows = await db`SELECT * FROM invoice_documents WHERE invoice_ref = ${invoiceRef}`;
    const first = (rows as Record<string, unknown>[])[0];
    return first ? toInvoiceDocumentRow(first) : null;
  });
}
