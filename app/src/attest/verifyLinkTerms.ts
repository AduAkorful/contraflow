import { recoverTypedDataAddress } from "viem";
import { hashInvoiceDocument, type CanonicalInvoiceDocument } from "./document";
import type { AttestLinkPayload } from "./link";
import { invoiceAttestationTypedData } from "./signAttestation";

export const ALTERED_LINK = "This link is invalid or has been altered.";

export type LinkFreshness = { ok: true; fresh: boolean } | { ok: false; error: string };

export type LinkTermsCheck =
  | { ok: true }
  | { ok: false; phase: "invalid" | "stale" | "error"; error: string };

/// Checks a decoded invoice link in the counterparty's browser. The canonical document is compared
/// before either signature is recovered or trusted, and any mismatch is a full stop.
export async function verifyLinkTerms(
  decoded: AttestLinkPayload,
  terms: CanonicalInvoiceDocument,
  checkFreshness: (debtor: string, creditor: string, nonce: string) => Promise<LinkFreshness>,
): Promise<LinkTermsCheck> {
  let documentHash: string;
  try {
    documentHash = hashInvoiceDocument(terms);
  } catch {
    return { ok: false, phase: "invalid", error: ALTERED_LINK };
  }
  if (documentHash !== decoded.invoice.invoiceRef) return { ok: false, phase: "invalid", error: ALTERED_LINK };

  const claimedSigner = decoded.role === "debtor" ? decoded.invoice.debtor : decoded.invoice.creditor;
  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      ...invoiceAttestationTypedData(decoded.invoice),
      signature: decoded.signatureA,
    });
  } catch {
    return { ok: false, phase: "invalid", error: ALTERED_LINK };
  }
  if (recovered.toLowerCase() !== claimedSigner.toLowerCase()) return { ok: false, phase: "invalid", error: ALTERED_LINK };

  const freshness = await checkFreshness(decoded.invoice.debtor, decoded.invoice.creditor, decoded.invoice.nonce.toString());
  if (!freshness.ok) return { ok: false, phase: "error", error: freshness.error };
  if (!freshness.fresh) {
    return {
      ok: false,
      phase: "stale",
      error: "This invoice is no longer current — it may already be registered, or a newer one exists for this pair.",
    };
  }
  return { ok: true };
}
