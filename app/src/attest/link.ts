/// Versioned attest link payload. Version 2 keeps invoice descriptions out of the share URL and
/// requires a party-gated document read at the destination. Version 1 is the legacy self-contained
/// format; it remains readable for existing links, which already disclose their embedded terms.
/// `InvoiceAttestation`'s `amount`/`maturity`/`nonce`/`chainId` fields are `bigint`, which
/// `JSON.stringify` can't serialize directly — encoded
/// as decimal strings here and parsed back to `bigint` on decode, never round-tripped through a
/// JS `number`.
///
/// Both `encodeAttestLink` (Party A, after signing) and `decodeAttestLink` (Party B, before
/// rendering anything) run in the browser, not just on the server — so this file deliberately uses
/// only universally-available `btoa`/`atob`/`TextEncoder`/`TextDecoder`, never Node's `Buffer`,
/// which isn't guaranteed present in a client bundle.

import type { Address, Hex } from "viem";
import type { InvoiceAttestation } from "./signAttestation";
import type { CanonicalInvoiceDocument } from "./document";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface AttestLinkBase {
  invoice: InvoiceAttestation;
  role: "debtor" | "creditor";
  signatureA: Hex;
}

export type AttestLinkPayload = AttestLinkBase &
  (
    | { version: 2; document?: never }
    | { version: 1; document: CanonicalInvoiceDocument }
  );

export type AttestLinkInput = AttestLinkBase;

interface SerializedInvoice {
  invoiceRef: Hex;
  amount: string;
  currency: Address;
  maturity: string;
  earlyNetConsent: boolean;
  debtor: Address;
  creditor: Address;
  nonce: string;
  registry: Address;
  chainId: string;
}

export function encodeAttestLink(payload: AttestLinkInput): string {
  const serialized = {
    version: 2,
    invoice: {
      ...payload.invoice,
      amount: payload.invoice.amount.toString(),
      maturity: payload.invoice.maturity.toString(),
      nonce: payload.invoice.nonce.toString(),
      chainId: payload.invoice.chainId.toString(),
    } satisfies SerializedInvoice,
    role: payload.role,
    signatureA: payload.signatureA,
  };
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(serialized)));
}

export class MalformedAttestLinkError extends Error {
  constructor() {
    super("This link is invalid or has been altered.");
    this.name = "MalformedAttestLinkError";
  }
}

export function decodeAttestLink(encoded: string): AttestLinkPayload {
  let parsed: Record<string, unknown>;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(encoded));
    parsed = JSON.parse(json);
  } catch {
    throw new MalformedAttestLinkError();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MalformedAttestLinkError();
  if (!parsed.invoice || (parsed.role !== "debtor" && parsed.role !== "creditor") || typeof parsed.signatureA !== "string") {
    throw new MalformedAttestLinkError();
  }

  const invoice = parsed.invoice as SerializedInvoice;
  if (
    typeof invoice.amount !== "string" ||
    typeof invoice.maturity !== "string" ||
    typeof invoice.nonce !== "string" ||
    typeof invoice.chainId !== "string"
  ) {
    throw new MalformedAttestLinkError();
  }

  const version = parsed.version === undefined ? 1 : parsed.version;
  let document: CanonicalInvoiceDocument | undefined;
  if (version === 1) {
    const candidate = parsed.document as Partial<CanonicalInvoiceDocument> | undefined;
    if (
      !candidate ||
      typeof candidate.description !== "string" ||
      typeof candidate.debtor !== "string" ||
      typeof candidate.creditor !== "string" ||
      typeof candidate.amountUsdc !== "string" ||
      typeof candidate.maturity !== "string"
    ) {
      throw new MalformedAttestLinkError();
    }
    document = candidate as CanonicalInvoiceDocument;
  } else if (version === 2) {
    // Reject a v2 link carrying legacy terms; otherwise a downgrade or malformed payload could
    // accidentally restore bearer access to the description.
    if (parsed.document !== undefined) throw new MalformedAttestLinkError();
  } else {
    throw new MalformedAttestLinkError();
  }

  try {
    const base: AttestLinkBase = {
      invoice: {
        invoiceRef: invoice.invoiceRef,
        amount: BigInt(invoice.amount),
        currency: invoice.currency,
        maturity: BigInt(invoice.maturity),
        earlyNetConsent: invoice.earlyNetConsent,
        debtor: invoice.debtor,
        creditor: invoice.creditor,
        nonce: BigInt(invoice.nonce),
        registry: invoice.registry,
        chainId: BigInt(invoice.chainId),
      },
      role: parsed.role,
      signatureA: parsed.signatureA as Hex,
    };
    return version === 1 ? { ...base, version: 1, document: document! } : { ...base, version: 2 };
  } catch {
    throw new MalformedAttestLinkError();
  }
}
