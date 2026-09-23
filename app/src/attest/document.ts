/// Canonical invoice document hashing. `invoiceRef` is `keccak256(canonicalizeDocument(doc))`
/// instead of a random value, so the hash
/// *is* the thing actually attested, not an afterthought. Pure, browser-and-server-safe (no
/// Node-only APIs), since `ComposeForm.tsx` and `LandingClient.tsx` both call this client-side —
/// same constraint `src/attest/link.ts` already documents for itself.

import { keccak256, toHex, type Address, type Hex } from "viem";

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
