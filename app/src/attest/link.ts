/// Self-contained attest link payload — no server-side state.
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

export interface AttestLinkPayload {
  invoice: InvoiceAttestation;
  role: "debtor" | "creditor";
  signatureA: Hex;
}

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

export function encodeAttestLink(payload: AttestLinkPayload): string {
  const serialized = {
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
  let parsed: { invoice: SerializedInvoice; role: "debtor" | "creditor"; signatureA: Hex };
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(encoded));
    parsed = JSON.parse(json);
  } catch {
    throw new MalformedAttestLinkError();
  }

  if (!parsed?.invoice || !parsed.role || !parsed.signatureA) throw new MalformedAttestLinkError();

  const { invoice } = parsed;
  if (
    typeof invoice.amount !== "string" ||
    typeof invoice.maturity !== "string" ||
    typeof invoice.nonce !== "string" ||
    typeof invoice.chainId !== "string"
  ) {
    throw new MalformedAttestLinkError();
  }

  try {
    return {
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
      signatureA: parsed.signatureA,
    };
  } catch {
    throw new MalformedAttestLinkError();
  }
}
