/// Server-only short invoice links. The token is a handle: only a signed-in debtor or creditor
/// receives the payload. Non-parties get "Not found", never "Forbidden", and signed-out
/// viewers are not told who the parties are.

import type { Address } from "viem";
import { decodeAttestLink, serializeAttestLink } from "./link";
import { insertInvoiceLink, getInvoiceLinkByToken } from "../db/invoiceLinks";
import { isShareToken, newShareToken } from "../share/shareToken";

const NOT_FOUND = "Not found.";

type Result<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

export async function createInvoiceShareLink(
  session: Address,
  encoded: string,
): Promise<Result<{ token: string }>> {
  let payload;
  try {
    payload = decodeAttestLink(encoded);
  } catch {
    return { ok: false, error: "This link is invalid or has been altered." };
  }
  if (payload.version !== 2) {
    return { ok: false, error: "Short links are only created for new invoices." };
  }
  const signer = payload.role === "debtor" ? payload.invoice.debtor : payload.invoice.creditor;
  if (signer.toLowerCase() !== session.toLowerCase()) {
    return { ok: false, error: NOT_FOUND };
  }
  const token = await insertInvoiceLink({
    token: newShareToken(),
    payload: serializeAttestLink({
      invoice: payload.invoice,
      role: payload.role,
      signatureA: payload.signatureA,
    }),
    debtor: payload.invoice.debtor,
    creditor: payload.invoice.creditor,
  });
  return { ok: true, token };
}

export async function getInvoiceShareLink(
  session: Address,
  token: unknown,
): Promise<Result<{ payload: unknown }>> {
  if (!isShareToken(token)) return { ok: false, error: NOT_FOUND };
  const row = await getInvoiceLinkByToken(token);
  if (!row) return { ok: false, error: NOT_FOUND };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, error: NOT_FOUND };
  const me = session.toLowerCase();
  if (row.debtor !== me && row.creditor !== me) return { ok: false, error: NOT_FOUND };
  return { ok: true, payload: row.payload };
}
