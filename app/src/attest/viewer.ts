import type { Address } from "viem";
import type { InvoiceAttestation } from "./signAttestation";

export type InvoiceViewerRole = "debtor" | "creditor" | null;

/// Resolve a viewer's role only from the authenticated session identity.
export function invoiceViewerRole(invoice: Pick<InvoiceAttestation, "debtor" | "creditor">, sessionAddress: string | null): InvoiceViewerRole {
  if (!sessionAddress) return null;
  const viewer = sessionAddress.toLowerCase();
  if (viewer === invoice.debtor.toLowerCase()) return "debtor";
  if (viewer === invoice.creditor.toLowerCase()) return "creditor";
  return null;
}

/// The second signature belongs to the party opposite the link creator.
export function isInvoiceCounterparty(invoice: Pick<InvoiceAttestation, "debtor" | "creditor">, role: "debtor" | "creditor", sessionAddress: string | null, walletAddress: Address | undefined): boolean {
  if (!sessionAddress || !walletAddress || sessionAddress.toLowerCase() !== walletAddress.toLowerCase()) return false;
  const expected = role === "debtor" ? invoice.creditor : invoice.debtor;
  return sessionAddress.toLowerCase() === expected.toLowerCase();
}
