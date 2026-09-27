/// Certificates: turning a loop of obligations into the onchain `NettingCertificate`, and the
/// hashes that tie its public commitments to the private documents behind them.
///
/// `contentHash` is built per entry so each party can check it while holding only its own two
/// obligations in full: every other entry is carried as its `entryHash` alone, and the blindings
/// inside each one stop anyone recovering the hidden amounts by guessing.

import {
  encodeAbiParameters,
  hashTypedData,
  isAddressEqual,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { commitment, isZeroHash, randomBlinding, ZERO_HASH } from "./commitment";
import { isIsoCurrency } from "./currency";
import { ledgerEip712Domain, MAX_LOOP_LENGTH, MIN_LOOP_LENGTH, NETTING_CERTIFICATE_TYPES } from "./domain";
import { obligationId } from "./obligation";
import type {
  CertificateEntry,
  CertificateView,
  EntryDocument,
  LedgerDomain,
  NettingCertificate,
  NettingObligation,
  ViewEntry,
} from "./types";

/// Bumped if the `entryHash`/`contentHash` encodings ever change, so an old certificate can
/// never be read under new rules.
export const CONTENT_VERSION = 1n;

export class CertificateBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertificateBuildError";
  }
}

/// `keccak256(abi.encode(obligationId, remainingBefore, blindingBefore, remainingAfter,
/// blindingAfter, keccak256(debtorSignature), keccak256(creditorSignature)))`.
export function entryHash(document: EntryDocument, domain: LedgerDomain): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        obligationId(document.obligation, domain),
        document.remainingBefore,
        document.blindingBefore,
        document.remainingAfter,
        document.blindingAfter,
        keccak256(document.debtorSignature),
        keccak256(document.creditorSignature),
      ],
    ),
  );
}

/// `keccak256(abi.encode(CONTENT_VERSION, keccak256(bytes(currency)), wNet, entryHashes))`.
export function contentHash(params: { currency: string; wNet: bigint; entryHashes: Hex[] }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32[]" }],
      [CONTENT_VERSION, keccak256(toBytes(params.currency)), params.wNet, params.entryHashes],
    ),
  );
}

/// The `entryHash` of a view entry, whether held in full or only as its hash.
export function viewEntryHash(entry: ViewEntry, domain: LedgerDomain): Hex {
  return entry.kind === "full" ? entryHash(entry.document, domain) : entry.entryHash;
}

/// What every party in the loop signs.
export function certificateTypedData(certificate: NettingCertificate, domain: LedgerDomain) {
  return {
    domain: ledgerEip712Domain(domain),
    types: NETTING_CERTIFICATE_TYPES,
    primaryType: "NettingCertificate" as const,
    message: certificate,
  };
}

export function certificateDigest(certificate: NettingCertificate, domain: LedgerDomain): Hex {
  return hashTypedData(certificateTypedData(certificate, domain));
}

/// The ledger's own loop rules: 2–5 entries, no zero address, each creditor is the next entry's
/// debtor (wrapping round), and no debtor twice. Returns the first problem, or `null`.
export function loopShapeProblem(entries: readonly Pick<CertificateEntry, "debtor" | "creditor">[]): string | null {
  const n = entries.length;
  if (n < MIN_LOOP_LENGTH || n > MAX_LOOP_LENGTH) {
    return `a loop has ${MIN_LOOP_LENGTH}–${MAX_LOOP_LENGTH} entries, this has ${n}`;
  }
  for (let i = 0; i < n; i++) {
    const entry = entries[i]!;
    const next = entries[(i + 1) % n]!;
    if (isAddressEqual(entry.debtor, zeroAddress) || isAddressEqual(entry.creditor, zeroAddress)) {
      return `entry ${i} has a zero address`;
    }
    if (!isAddressEqual(entry.creditor, next.debtor)) {
      return `entry ${i}'s creditor is not entry ${(i + 1) % n}'s debtor`;
    }
    for (let j = 0; j < i; j++) {
      if (isAddressEqual(entries[j]!.debtor, entry.debtor)) return `${entry.debtor} is a debtor twice`;
    }
  }
  return null;
}

/// The prior commitment for an obligation's current state: empty if it has never been netted.
export function priorCommitmentOf(id: Hex, remaining: bigint, blinding: Hex): Hex {
  return isZeroHash(blinding) ? ZERO_HASH : commitment(id, remaining, blinding);
}

export interface LoopObligation {
  obligation: NettingObligation;
  debtorSignature: Hex;
  creditorSignature: Hex;
  /// Its current state, as last agreed: the full amount and the zero hash if never netted.
  remaining: bigint;
  blinding: Hex;
}

export interface BuildCertificateInput {
  domain: LedgerDomain;
  currency: string;
  wNet: bigint;
  deadline: bigint;
  /// In loop order: each obligation's creditor is the next one's debtor.
  loop: LoopObligation[];
}

/// Turns a loop into a certificate, with fresh blindings and a random id, as a full view with no
/// signatures yet. Throws on any inconsistency: the proposer must never put out a certificate it
/// wouldn't itself verify. Obligation signatures aren't checked here, because a smart-account
/// signer needs a chain to check against; `verifyCertificateView` covers them.
export function buildCertificate(input: BuildCertificateInput): CertificateView {
  const { domain, currency, wNet, deadline, loop } = input;

  const shapeProblem = loopShapeProblem(loop.map((l) => l.obligation));
  if (shapeProblem) throw new CertificateBuildError(`Not a valid loop: ${shapeProblem}`);
  if (!isIsoCurrency(currency)) throw new CertificateBuildError(`Not an ISO 4217 currency code: ${currency}`);
  if (wNet <= 0n) throw new CertificateBuildError("wNet must be positive");
  if (deadline <= 0n) throw new CertificateBuildError("deadline must be set");

  const documents: EntryDocument[] = loop.map((item, i) => {
    const { obligation, remaining, blinding } = item;
    if (obligation.currency !== currency) {
      throw new CertificateBuildError(`Obligation ${i} is in ${obligation.currency}, not ${currency}`);
    }
    if (remaining > obligation.amount) {
      throw new CertificateBuildError(`Obligation ${i} has more remaining than its amount`);
    }
    if (isZeroHash(blinding) && remaining !== obligation.amount) {
      throw new CertificateBuildError(`Obligation ${i} was never netted, so its remaining must be its full amount`);
    }
    if (wNet > remaining) throw new CertificateBuildError(`wNet exceeds obligation ${i}'s remaining ${remaining}`);
    return {
      obligation,
      debtorSignature: item.debtorSignature,
      creditorSignature: item.creditorSignature,
      remainingBefore: remaining,
      blindingBefore: blinding,
      remainingAfter: remaining - wNet,
      blindingAfter: randomBlinding(),
    };
  });

  const entries: CertificateEntry[] = documents.map((doc) => {
    const id = obligationId(doc.obligation, domain);
    return {
      obligationId: id,
      debtor: doc.obligation.debtor,
      creditor: doc.obligation.creditor,
      priorCommitment: priorCommitmentOf(id, doc.remainingBefore, doc.blindingBefore),
      nextCommitment: commitment(id, doc.remainingAfter, doc.blindingAfter),
    };
  });

  const certificate: NettingCertificate = {
    certificateId: randomBlinding(),
    contentHash: contentHash({ currency, wNet, entryHashes: documents.map((doc) => entryHash(doc, domain)) }),
    deadline,
    entries,
  };

  return {
    domain,
    currency,
    wNet,
    certificate,
    signatures: entries.map(() => null),
    entries: documents.map((document) => ({ kind: "full", document })),
  };
}

/// Adds the parties' certificate signatures, one per entry, from that entry's debtor.
export function withSignatures(view: CertificateView, signatures: Hex[]): CertificateView {
  if (signatures.length !== view.certificate.entries.length) {
    throw new CertificateBuildError(
      `Expected ${view.certificate.entries.length} signatures, got ${signatures.length}`,
    );
  }
  return { ...view, signatures: [...signatures] };
}

/// What one party receives: its own two entries in full, every other entry as its hash only.
/// Throws if the party isn't in the loop.
export function viewForParty(view: CertificateView, party: Address): CertificateView {
  const involved = (e: CertificateEntry) => isAddressEqual(e.debtor, party) || isAddressEqual(e.creditor, party);
  if (!view.certificate.entries.some(involved)) {
    throw new CertificateBuildError(`${party} is not a party to this certificate`);
  }
  return {
    ...view,
    entries: view.entries.map((entry, i) =>
      involved(view.certificate.entries[i]!) || entry.kind === "hash"
        ? entry
        : { kind: "hash", entryHash: entryHash(entry.document, view.domain) },
    ),
  };
}
