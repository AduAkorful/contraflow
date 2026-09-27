/// The standalone certificate verifier. Anyone holding a certificate view can run it without
/// trusting Contraflow: it recomputes every hash and checks every signature itself, and only
/// reads the chain when given a client.
///
/// It reports named checks, each `pass`, `fail` or `unverifiable`, and `ok` only when every one
/// passes. It never throws on bad input: a malformed view is itself a failed check.

import { isAddress, isAddressEqual, isHex, size, type Hex } from "viem";
import { contraflowNettingLedgerAbi } from "../contracts/abi/index";
import {
  certificateDigest,
  contentHash,
  loopShapeProblem,
  priorCommitmentOf,
  viewEntryHash,
} from "./certificate";
import { commitment, isZeroHash } from "./commitment";
import { isIsoCurrency } from "./currency";
import { obligationId, obligationKey } from "./obligation";
import { checkSignature, combineStatuses, type ChainReader, type CheckStatus } from "./signature";
import type { CertificateView, EntryDocument } from "./types";

export type { CheckStatus } from "./signature";

export interface VerificationCheck {
  /// Stable identifier, e.g. `certificate-signature:0` or `entry:1:amounts`.
  name: string;
  status: CheckStatus;
  detail?: string;
}

export interface VerificationResult {
  ok: boolean;
  checks: VerificationCheck[];
}

/// How far along the certificate is, which decides what's required of it:
/// - `proposed`: not signed yet (what a party checks before signing), so signatures aren't checked;
/// - `signed`: every party's signature is required;
/// - `applied`: also confirmed against the ledger, which needs `client`.
export type VerificationStage = "proposed" | "signed" | "applied";

export interface VerifyOptions {
  /// Unix seconds, for the maturity rule.
  now: bigint;
  stage?: VerificationStage;
  /// A client for the ledger's chain. Without one, smart-account signatures and onchain state
  /// are `unverifiable`.
  client?: ChainReader;
}

export async function verifyCertificateView(view: CertificateView, options: VerifyOptions): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  const add = (name: string, status: CheckStatus, detail?: string) => checks.push({ name, status, detail });

  try {
    await runChecks(view, options, add);
  } catch (error) {
    add("verifier", "fail", `Could not finish verifying: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { ok: checks.length > 0 && checks.every((c) => c.status === "pass"), checks };
}

type AddCheck = (name: string, status: CheckStatus, detail?: string) => void;

async function runChecks(view: CertificateView, options: VerifyOptions, add: AddCheck): Promise<void> {
  const stage = options.stage ?? "signed";
  const { client } = options;

  const shapeProblem = viewShapeProblem(view);
  if (shapeProblem) {
    add("view.shape", "fail", shapeProblem);
    return;
  }
  add("view.shape", "pass");

  const { domain, certificate } = view;
  const entries = certificate.entries;

  if (client) {
    const chainId = BigInt(await client.getChainId());
    if (chainId !== domain.chainId) {
      add("chain", "fail", `The client is on chain ${chainId}, the certificate is for chain ${domain.chainId}`);
      return;
    }
    add("chain", "pass");
  }

  const loopProblem = loopShapeProblem(entries);
  add("certificate.loop", loopProblem ? "fail" : "pass", loopProblem ?? undefined);

  if (stage !== "proposed") {
    const digest = certificateDigest(certificate, domain);
    for (let i = 0; i < entries.length; i++) {
      const signer = entries[i]!.debtor;
      const signature = view.signatures[i];
      if (!signature) {
        add(`certificate-signature:${i}`, "fail", `No signature from ${signer}`);
        continue;
      }
      const result = await checkSignature(signer, digest, signature, client);
      add(`certificate-signature:${i}`, result.status, result.detail);
    }
  }

  const fullCount = view.entries.filter((e) => e.kind === "full").length;
  add(
    "view.coverage",
    fullCount > 0 ? "pass" : "fail",
    fullCount > 0 ? `${fullCount} of ${entries.length} entries held in full` : "No entry is held in full",
  );

  for (let i = 0; i < view.entries.length; i++) {
    const held = view.entries[i]!;
    if (held.kind === "full") await checkFullEntry(view, i, held.document, options, add);
  }

  const recomputed = contentHash({
    currency: view.currency,
    wNet: view.wNet,
    entryHashes: view.entries.map((entry) => viewEntryHash(entry, domain)),
  });
  add(
    "content-hash",
    recomputed === certificate.contentHash.toLowerCase() ? "pass" : "fail",
    recomputed === certificate.contentHash.toLowerCase()
      ? undefined
      : "The certificate's contentHash doesn't match its contents",
  );

  if (stage === "applied") await checkOnchain(view, add, client);
}

async function checkFullEntry(
  view: CertificateView,
  i: number,
  doc: EntryDocument,
  options: VerifyOptions,
  add: AddCheck,
): Promise<void> {
  const { domain, wNet } = view;
  const entry = view.certificate.entries[i]!;
  const { obligation } = doc;
  const id = obligationId(obligation, domain);
  const prefix = `entry:${i}`;

  add(`${prefix}:obligation-id`, id === entry.obligationId.toLowerCase() ? "pass" : "fail");

  const partiesMatch = isAddressEqual(obligation.debtor, entry.debtor) && isAddressEqual(obligation.creditor, entry.creditor);
  add(`${prefix}:parties`, partiesMatch ? "pass" : "fail");

  const debtorSig = await checkSignature(obligation.debtor, id, doc.debtorSignature, options.client);
  const creditorSig = await checkSignature(obligation.creditor, id, doc.creditorSignature, options.client);
  add(
    `${prefix}:obligation-signatures`,
    combineStatuses([debtorSig.status, creditorSig.status]),
    `Debtor: ${debtorSig.detail}. Creditor: ${creditorSig.detail}.`,
  );

  const currencyOk = obligation.currency === view.currency && isIsoCurrency(view.currency);
  add(`${prefix}:currency`, currencyOk ? "pass" : "fail");

  const neverNetted = isZeroHash(doc.blindingBefore);
  const priorOk =
    doc.remainingBefore <= obligation.amount &&
    (!neverNetted || doc.remainingBefore === obligation.amount) &&
    priorCommitmentOf(id, doc.remainingBefore, doc.blindingBefore) === entry.priorCommitment.toLowerCase();
  add(`${prefix}:prior-commitment`, priorOk ? "pass" : "fail");

  const amountsOk = wNet > 0n && wNet <= doc.remainingBefore && doc.remainingAfter === doc.remainingBefore - wNet;
  add(`${prefix}:amounts`, amountsOk ? "pass" : "fail");

  const nextOk =
    !isZeroHash(doc.blindingAfter) &&
    commitment(id, doc.remainingAfter, doc.blindingAfter) === entry.nextCommitment.toLowerCase();
  add(`${prefix}:next-commitment`, nextOk ? "pass" : "fail");

  const matured = obligation.maturity <= options.now;
  add(
    `${prefix}:maturity`,
    matured || obligation.earlyNetConsent ? "pass" : "fail",
    matured ? "Matured" : obligation.earlyNetConsent ? "Not yet mature; both parties consented to early netting" : "Not yet mature and no consent to net early",
  );
}

async function checkOnchain(view: CertificateView, add: AddCheck, client: ChainReader | undefined): Promise<void> {
  if (!client) {
    add("onchain", "unverifiable", "No chain client given, so the ledger wasn't read");
    return;
  }
  const ledger = view.domain.verifyingContract;
  const { certificate } = view;

  const applied = (await client.readContract({
    address: ledger,
    abi: contraflowNettingLedgerAbi,
    functionName: "isApplied",
    args: [certificate.certificateId],
  })) as boolean;
  add("onchain:applied", applied ? "pass" : "fail", applied ? undefined : "The ledger has not applied this certificate");
  if (!applied) return;

  for (let i = 0; i < view.entries.length; i++) {
    if (view.entries[i]!.kind !== "full") continue;
    const entry = certificate.entries[i]!;
    const state = (await client.readContract({
      address: ledger,
      abi: contraflowNettingLedgerAbi,
      functionName: "stateOf",
      args: [obligationKey(entry.obligationId, entry.debtor, entry.creditor)],
    })) as Hex;
    // Once applied, a slot only changes again through a later certificate whose prior
    // commitment is exactly this one's next, so a different value means it was netted again.
    const current = state.toLowerCase() === entry.nextCommitment.toLowerCase();
    add(`onchain:entry:${i}:state`, "pass", current ? "Current state" : "Netted again since");
  }
}

const isHash = (value: unknown): value is Hex => typeof value === "string" && isHex(value) && size(value) === 32;
const isSignature = (value: unknown): value is Hex => typeof value === "string" && isHex(value);
const isAddr = (value: unknown) => typeof value === "string" && isAddress(value, { strict: false });
const isUint = (value: unknown) => typeof value === "bigint" && value >= 0n;

/// Checks every field has the right type before any hashing, so a malformed view fails one
/// clear check instead of throwing somewhere inside viem.
export function viewShapeProblem(view: CertificateView): string | null {
  if (!view || typeof view !== "object") return "Not a certificate view";
  const { domain, certificate } = view;
  if (!domain || !isUint(domain.chainId) || !isAddr(domain.verifyingContract)) return "Bad domain";
  if (typeof view.currency !== "string") return "Bad currency";
  if (!isUint(view.wNet)) return "Bad wNet";
  if (!certificate || !isHash(certificate.certificateId) || !isHash(certificate.contentHash)) return "Bad certificate";
  if (!isUint(certificate.deadline) || !Array.isArray(certificate.entries)) return "Bad certificate";
  for (const e of certificate.entries) {
    if (!e || !isHash(e.obligationId) || !isHash(e.priorCommitment) || !isHash(e.nextCommitment)) {
      return "Bad certificate entry";
    }
    if (!isAddr(e.debtor) || !isAddr(e.creditor)) return "Bad certificate entry";
  }
  const n = certificate.entries.length;
  if (!Array.isArray(view.signatures) || view.signatures.length !== n) return "Signature count doesn't match entries";
  if (view.signatures.some((s) => s !== null && !isSignature(s))) return "Bad signature";
  if (!Array.isArray(view.entries) || view.entries.length !== n) return "Held entries don't line up with the certificate";
  for (const entry of view.entries) {
    if (entry?.kind === "hash") {
      if (!isHash(entry.entryHash)) return "Bad entry hash";
    } else if (entry?.kind === "full") {
      const problem = documentShapeProblem(entry.document);
      if (problem) return problem;
    } else {
      return "Unknown entry kind";
    }
  }
  return null;
}

function documentShapeProblem(doc: EntryDocument): string | null {
  const o = doc?.obligation;
  if (!o || !isHash(o.documentHash) || !isHash(o.salt) || !isAddr(o.debtor) || !isAddr(o.creditor)) {
    return "Bad obligation";
  }
  if (typeof o.currency !== "string" || !isUint(o.amount) || !isUint(o.maturity) || typeof o.earlyNetConsent !== "boolean") {
    return "Bad obligation";
  }
  if (!isSignature(doc.debtorSignature) || !isSignature(doc.creditorSignature)) return "Bad obligation signature";
  if (!isUint(doc.remainingBefore) || !isUint(doc.remainingAfter)) return "Bad entry amounts";
  if (!isHash(doc.blindingBefore) || !isHash(doc.blindingAfter)) return "Bad entry blinding";
  return null;
}
