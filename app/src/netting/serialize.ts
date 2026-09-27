/// The export format for a certificate view, `contraflow-netting-certificate/1`: plain JSON with
/// integers as decimal strings and hex in lowercase. Parsing checks every type and rejects
/// unknown versions, but proves nothing about validity: always run `verifyCertificateView` on
/// what comes out.

import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import type {
  CertificateEntry,
  CertificateView,
  EntryDocument,
  NettingObligation,
  ViewEntry,
} from "./types";

export const CERTIFICATE_FORMAT = "contraflow-netting-certificate/1";

export class CertificateFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertificateFormatError";
  }
}

const hex = (value: Hex) => value.toLowerCase();

export function serializeCertificateView(view: CertificateView): string {
  return JSON.stringify(
    {
      format: CERTIFICATE_FORMAT,
      domain: { chainId: view.domain.chainId.toString(), verifyingContract: hex(view.domain.verifyingContract) },
      currency: view.currency,
      wNet: view.wNet.toString(),
      certificate: {
        certificateId: hex(view.certificate.certificateId),
        contentHash: hex(view.certificate.contentHash),
        deadline: view.certificate.deadline.toString(),
        entries: view.certificate.entries.map((e) => ({
          obligationId: hex(e.obligationId),
          debtor: hex(e.debtor),
          creditor: hex(e.creditor),
          priorCommitment: hex(e.priorCommitment),
          nextCommitment: hex(e.nextCommitment),
        })),
      },
      signatures: view.signatures.map((s) => (s === null ? null : hex(s))),
      entries: view.entries.map((entry) =>
        entry.kind === "hash"
          ? { kind: "hash", entryHash: hex(entry.entryHash) }
          : { kind: "full", document: serializeDocument(entry.document) },
      ),
    },
    null,
    2,
  );
}

/// A `NettingObligation` as plain JSON (integers as decimal strings), for anywhere one crosses a
/// JSON boundary: exports, stored proposals, server-action results.
export function serializeObligation(o: NettingObligation) {
  return {
    documentHash: hex(o.documentHash),
    debtor: hex(o.debtor),
    creditor: hex(o.creditor),
    currency: o.currency,
    amount: o.amount.toString(),
    maturity: o.maturity.toString(),
    earlyNetConsent: o.earlyNetConsent,
    salt: hex(o.salt),
  };
}

export type SerializedObligation = ReturnType<typeof serializeObligation>;

/// Strict inverse of `serializeObligation`. Throws `CertificateFormatError` on any wrong type.
export function parseObligationJson(value: unknown): NettingObligation {
  return parseObligation(value, "obligation");
}

function serializeDocument(doc: EntryDocument) {
  return {
    obligation: serializeObligation(doc.obligation),
    debtorSignature: hex(doc.debtorSignature),
    creditorSignature: hex(doc.creditorSignature),
    remainingBefore: doc.remainingBefore.toString(),
    blindingBefore: hex(doc.blindingBefore),
    remainingAfter: doc.remainingAfter.toString(),
    blindingAfter: hex(doc.blindingAfter),
  };
}

export function parseCertificateView(json: string): CertificateView {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new CertificateFormatError("Not valid JSON");
  }
  const root = record(raw, "certificate file");
  if (root.format !== CERTIFICATE_FORMAT) {
    throw new CertificateFormatError(`Unsupported format ${JSON.stringify(root.format)}; expected ${CERTIFICATE_FORMAT}`);
  }
  const domain = record(root.domain, "domain");
  const certificate = record(root.certificate, "certificate");

  return {
    domain: { chainId: uint(domain.chainId, "domain.chainId"), verifyingContract: address(domain.verifyingContract, "domain.verifyingContract") },
    currency: string(root.currency, "currency"),
    wNet: uint(root.wNet, "wNet"),
    certificate: {
      certificateId: hexValue(certificate.certificateId, "certificate.certificateId"),
      contentHash: hexValue(certificate.contentHash, "certificate.contentHash"),
      deadline: uint(certificate.deadline, "certificate.deadline"),
      entries: array(certificate.entries, "certificate.entries").map((e, i) => parseEntry(e, `certificate.entries[${i}]`)),
    },
    signatures: array(root.signatures, "signatures").map((s, i) =>
      s === null ? null : hexValue(s, `signatures[${i}]`),
    ),
    entries: array(root.entries, "entries").map((e, i) => parseViewEntry(e, `entries[${i}]`)),
  };
}

function parseEntry(value: unknown, path: string): CertificateEntry {
  const e = record(value, path);
  return {
    obligationId: hexValue(e.obligationId, `${path}.obligationId`),
    debtor: address(e.debtor, `${path}.debtor`),
    creditor: address(e.creditor, `${path}.creditor`),
    priorCommitment: hexValue(e.priorCommitment, `${path}.priorCommitment`),
    nextCommitment: hexValue(e.nextCommitment, `${path}.nextCommitment`),
  };
}

function parseViewEntry(value: unknown, path: string): ViewEntry {
  const e = record(value, path);
  if (e.kind === "hash") return { kind: "hash", entryHash: hexValue(e.entryHash, `${path}.entryHash`) };
  if (e.kind !== "full") throw new CertificateFormatError(`${path}.kind must be "full" or "hash"`);
  const d = record(e.document, `${path}.document`);
  return {
    kind: "full",
    document: {
      obligation: parseObligation(d.obligation, `${path}.document.obligation`),
      debtorSignature: hexValue(d.debtorSignature, `${path}.document.debtorSignature`),
      creditorSignature: hexValue(d.creditorSignature, `${path}.document.creditorSignature`),
      remainingBefore: uint(d.remainingBefore, `${path}.document.remainingBefore`),
      blindingBefore: hexValue(d.blindingBefore, `${path}.document.blindingBefore`),
      remainingAfter: uint(d.remainingAfter, `${path}.document.remainingAfter`),
      blindingAfter: hexValue(d.blindingAfter, `${path}.document.blindingAfter`),
    },
  };
}

function parseObligation(value: unknown, path: string): NettingObligation {
  const o = record(value, path);
  if (typeof o.earlyNetConsent !== "boolean") throw new CertificateFormatError(`${path}.earlyNetConsent must be a boolean`);
  return {
    documentHash: hexValue(o.documentHash, `${path}.documentHash`),
    debtor: address(o.debtor, `${path}.debtor`),
    creditor: address(o.creditor, `${path}.creditor`),
    currency: string(o.currency, `${path}.currency`),
    amount: uint(o.amount, `${path}.amount`),
    maturity: uint(o.maturity, `${path}.maturity`),
    earlyNetConsent: o.earlyNetConsent,
    salt: hexValue(o.salt, `${path}.salt`),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CertificateFormatError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new CertificateFormatError(`${path} must be an array`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new CertificateFormatError(`${path} must be a string`);
  return value;
}

function uint(value: unknown, path: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new CertificateFormatError(`${path} must be a non-negative integer as a decimal string`);
  }
  return BigInt(value);
}

function hexValue(value: unknown, path: string): Hex {
  if (typeof value !== "string" || !isHex(value, { strict: true }) || value.length % 2 !== 0) {
    throw new CertificateFormatError(`${path} must be hex`);
  }
  return value.toLowerCase() as Hex;
}

function address(value: unknown, path: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new CertificateFormatError(`${path} must be an address`);
  }
  return getAddress(value);
}
