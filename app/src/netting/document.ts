/// The human-readable document behind a Mode B obligation, and the `documentHash` both parties
/// sign over. Canonicalized the same way as Mode A's invoice documents (key-sorted JSON,
/// lowercased addresses, trimmed description), plus a `format` tag so an obligation document can
/// never hash-equal an invoice document. Browser-safe: both parties' browsers compute this.

import { isAddress, isAddressEqual, keccak256, toHex, zeroAddress, type Address, type Hex } from "viem";
import { isIsoCurrency, parseAmount } from "./currency";
import type { NettingObligation } from "./types";

export const OBLIGATION_DOCUMENT_FORMAT = "contraflow-obligation/1";
export const MAX_DESCRIPTION_LENGTH = 500;

export interface CanonicalObligationDocument {
  format: typeof OBLIGATION_DOCUMENT_FORMAT;
  description: string;
  debtor: Address;
  creditor: Address;
  /// ISO 4217 code.
  currency: string;
  /// Major units exactly as shown and signed, e.g. "1250.00".
  amount: string;
  /// yyyy-mm-dd.
  maturity: string;
  earlyNetConsent: boolean;
}

/// The fields a tenant (or either party) collects, before hashing. Sets `format` so callers don't
/// have to remember the tag; canonicalisation still lowercases addresses and trims the description.
export function buildObligationDocument(fields: Omit<CanonicalObligationDocument, "format">): CanonicalObligationDocument {
  return { format: OBLIGATION_DOCUMENT_FORMAT, ...fields };
}

/// Changing this output changes every documentHash: it's a security boundary both parties must
/// derive identically. Change it only together with a new `format` version.
export function canonicalizeObligationDocument(doc: CanonicalObligationDocument): string {
  return JSON.stringify({
    amount: doc.amount,
    creditor: doc.creditor.toLowerCase(),
    currency: doc.currency,
    debtor: doc.debtor.toLowerCase(),
    description: doc.description.trim(),
    earlyNetConsent: doc.earlyNetConsent,
    format: doc.format,
    maturity: doc.maturity,
  });
}

export function hashObligationDocument(doc: CanonicalObligationDocument): Hex {
  return keccak256(toHex(canonicalizeObligationDocument(doc)));
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/// Midnight UTC of a yyyy-mm-dd date, as unix seconds: the same conversion as Mode A's compose
/// form. Throws on anything that isn't a real calendar date.
export function maturityDateToUnixSeconds(date: string): bigint {
  const match = DATE_PATTERN.exec(date);
  const ms = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
  if (!match || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new Error(`Not a valid date: ${JSON.stringify(date)}`);
  }
  return BigInt(ms / 1000);
}

/// Anything wrong with a document on its own, before comparing it to an obligation.
export function obligationDocumentProblem(doc: CanonicalObligationDocument): string | null {
  if (!doc || typeof doc !== "object") return "Missing document";
  if (doc.format !== OBLIGATION_DOCUMENT_FORMAT) return "Unknown document format";
  if (typeof doc.description !== "string") return "Missing description";
  const description = doc.description.trim();
  if (description.length === 0) return "Add a description";
  if (description.length > MAX_DESCRIPTION_LENGTH) return `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`;
  if (!isAddress(doc.debtor, { strict: false }) || !isAddress(doc.creditor, { strict: false })) return "Invalid address";
  if (isAddressEqual(doc.debtor, zeroAddress) || isAddressEqual(doc.creditor, zeroAddress)) return "Invalid address";
  if (isAddressEqual(doc.debtor, doc.creditor)) return "Debtor and creditor must be different";
  if (typeof doc.currency !== "string" || !isIsoCurrency(doc.currency)) return "Not an ISO 4217 currency code";
  if (typeof doc.earlyNetConsent !== "boolean") return "Missing early-net consent";
  try {
    if (parseAmount(doc.amount, doc.currency) <= 0n) return "Amount must be more than zero";
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid amount";
  }
  try {
    maturityDateToUnixSeconds(doc.maturity);
  } catch {
    return "Invalid maturity date";
  }
  return null;
}

/// The `NettingObligation` a document describes. The salt is the only field not in the document.
export function obligationFromDocument(doc: CanonicalObligationDocument, salt: Hex): NettingObligation {
  return {
    documentHash: hashObligationDocument(doc),
    debtor: doc.debtor,
    creditor: doc.creditor,
    currency: doc.currency,
    amount: parseAmount(doc.amount, doc.currency),
    maturity: maturityDateToUnixSeconds(doc.maturity),
    earlyNetConsent: doc.earlyNetConsent,
    salt,
  };
}

/// Whether a signed obligation says exactly what its document says, field for field.
export function obligationMatchesDocument(obligation: NettingObligation, doc: CanonicalObligationDocument): boolean {
  const expected = obligationFromDocument(doc, obligation.salt);
  return (
    expected.documentHash === obligation.documentHash.toLowerCase() &&
    isAddressEqual(expected.debtor, obligation.debtor) &&
    isAddressEqual(expected.creditor, obligation.creditor) &&
    expected.currency === obligation.currency &&
    expected.amount === obligation.amount &&
    expected.maturity === obligation.maturity &&
    expected.earlyNetConsent === obligation.earlyNetConsent
  );
}
