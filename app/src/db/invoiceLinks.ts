/// Short invoice share-link rows. Access control lives in `src/attest/invoiceLinks.ts`.

import { sql, withDbRetry } from "./client";

const LINK_LIFETIME = "30 days";

export interface InvoiceLinkRow {
  token: string;
  payload: unknown;
  debtor: string;
  creditor: string;
  createdAt: Date;
  expiresAt: Date;
}

function toRow(r: Record<string, unknown>): InvoiceLinkRow {
  return {
    token: r.token as string,
    payload: r.payload,
    debtor: r.debtor as string,
    creditor: r.creditor as string,
    createdAt: r.created_at as Date,
    expiresAt: r.expires_at as Date,
  };
}

export async function insertInvoiceLink(input: {
  token: string;
  payload: unknown;
  debtor: string;
  creditor: string;
}): Promise<string> {
  await withDbRetry(async () => {
    const db = sql();
    await db`
      INSERT INTO invoice_links (token, payload, debtor, creditor, expires_at)
      VALUES (
        ${input.token},
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.debtor.toLowerCase()},
        ${input.creditor.toLowerCase()},
        now() + ${LINK_LIFETIME}::interval
      )
      ON CONFLICT DO NOTHING
    `;
  });
  const stored = await getInvoiceLinkByToken(input.token);
  if (!stored) throw new Error("insertInvoiceLink: the link was not stored");
  return stored.token;
}

export async function getInvoiceLinkByToken(token: string): Promise<InvoiceLinkRow | null> {
  return withDbRetry(async () => {
    const rows = (await sql()`SELECT * FROM invoice_links WHERE token = ${token}`) as Record<string, unknown>[];
    return rows[0] ? toRow(rows[0]) : null;
  });
}
