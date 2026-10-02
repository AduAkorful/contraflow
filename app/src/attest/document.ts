/// Canonical invoice document hashing. `invoiceRef` is `keccak256(canonicalizeDocument(doc))`
/// instead of a random value, so the hash
/// *is* the thing actually attested, not an afterthought. Pure, browser-and-server-safe (no
/// Node-only APIs), since `ComposeForm.tsx` and `LandingClient.tsx` both call this client-side —
/// same constraint `src/attest/link.ts` already documents for itself.

import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { formatUsdcAmount, parseUsdcAmount } from "./amount";

export interface CanonicalInvoiceDocument {
  description: string;
  debtor: Address;
  creditor: Address;
  /// Decimal string (e.g. "1000.00"), matching what's shown/signed — not the raw uint256 base
  /// units, so the hash is stable regardless of how the amount is later re-parsed.
  amountUsdc: string;
  /// ISO date (yyyy-mm-dd), matching `ComposeForm.tsx`'s date input.
  maturity: string;
}

/// Deterministic, key-sorted JSON — not `JSON.stringify(doc)` directly. Object key order isn't
/// part of this hash's security boundary; both parties must derive byte-identical output from
/// the same logical document regardless of how it was constructed.
export function canonicalizeDocument(doc: CanonicalInvoiceDocument): string {
  const ordered: Record<string, string> = {
    amountUsdc: doc.amountUsdc,
    creditor: doc.creditor.toLowerCase(),
    debtor: doc.debtor.toLowerCase(),
    description: doc.description.trim(),
    maturity: doc.maturity,
  };
  return JSON.stringify(ordered);
}

export function hashInvoiceDocument(doc: CanonicalInvoiceDocument): Hex {
  return keccak256(toHex(canonicalizeDocument(doc)));
}

/// Validates the canonical shape before persistence. The reference is checked separately so the
/// server derives the security boundary instead of trusting a client-supplied key.
export function invoiceDocumentProblem(doc: CanonicalInvoiceDocument): string | null {
  if (!doc || typeof doc !== "object") return "Invoice document is invalid";
  if (typeof doc.description !== "string" || doc.description.length === 0 || doc.description !== doc.description.trim()) {
    return "Invoice description must be non-empty and trimmed";
  }
  if (!isAddress(doc.debtor) || !isAddress(doc.creditor)) return "Invoice parties must be valid addresses";
  if (/^0x0{40}$/i.test(doc.debtor) || /^0x0{40}$/i.test(doc.creditor)) return "Invoice parties cannot be the zero address";
  if (doc.debtor.toLowerCase() === doc.creditor.toLowerCase()) return "Invoice parties must be different";
  if (typeof doc.amountUsdc !== "string") return "Invoice amount is invalid";
  try {
    if (formatUsdcAmount(parseUsdcAmount(doc.amountUsdc)) !== doc.amountUsdc) return "Invoice amount must use canonical USDC precision";
  } catch {
    return "Invoice amount is invalid";
  }
  if (typeof doc.maturity !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(doc.maturity)) return "Invoice maturity must be an ISO date";
  const date = new Date(`${doc.maturity}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== doc.maturity) return "Invoice maturity is invalid";
  return null;
}
