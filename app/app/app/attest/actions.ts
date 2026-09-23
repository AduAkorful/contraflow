"use server";

/// Server Actions behind `/app/attest`. Every action that acts "on behalf of the signed-in
/// party" derives the address from the verified session (`getSession()`), never from a
/// client-supplied parameter — same discipline applied consistently across every action here
/// and in `/app/history`.

import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { getSession } from "../../../src/session/getSession";
import { requestStarterGrant, grantAmountUsdc } from "../../../src/attest/starterGrant";
import { resolveNextNonce } from "../../../src/attest/nextNonce";
import { preCheckAttestation } from "../../../src/attest/precheck";
import { recordRegistration } from "../../../src/attest/record";
import type { InvoiceAttestation } from "../../../src/attest/signAttestation";
import type { CanonicalInvoiceDocument } from "../../../src/attest/document";
import { upsertInvoiceDocument, getInvoiceDocumentByRef } from "../../../src/db/documents";

export type GrantResult =
  | { ok: true; alreadyGranted: boolean; txHash?: string }
  | { ok: false; error: string };

export async function requestGrant(): Promise<GrantResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const result = await requestStarterGrant(session.address);
  if (!result.ok) return { ok: false, error: result.reason };
  if (result.alreadyGranted) return { ok: true, alreadyGranted: true };
  return { ok: true, alreadyGranted: false, txHash: result.txHash };
}

export async function starterGrantAmount(): Promise<string> {
  return grantAmountUsdc();
}

export type NonceResult = { ok: true; nonce: string } | { ok: false; error: string };

export async function nextNonceFor(debtor: string, creditor: string): Promise<NonceResult> {
  if (!isAddress(debtor) || !isAddress(creditor)) return { ok: false, error: "Invalid address." };
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };
  const nonce = await resolveNextNonce(debtor as Address, creditor as Address);
  return { ok: true, nonce: nonce.toString() };
}

export type FreshnessResult = { ok: true; fresh: boolean; expectedNonce: string } | { ok: false; error: string };

/// Deliberately NOT session-gated — this catches a stale link before Party B invests effort
/// signing, on their landing page, meant to run *before* they've connected or signed in at all.
/// The nonce comparison itself reveals nothing sensitive (it's derived from public on-chain
/// events either way).
export async function checkLinkFreshness(debtor: string, creditor: string, claimedNonce: string): Promise<FreshnessResult> {
  if (!isAddress(debtor) || !isAddress(creditor)) return { ok: false, error: "Invalid address." };
  const expected = await resolveNextNonce(debtor as Address, creditor as Address);
  return { ok: true, fresh: expected.toString() === claimedNonce, expectedNonce: expected.toString() };
}

interface SerializableInvoice {
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

function toInvoiceAttestation(s: SerializableInvoice): InvoiceAttestation {
  return {
    invoiceRef: s.invoiceRef,
    amount: BigInt(s.amount),
    currency: s.currency,
    maturity: BigInt(s.maturity),
    earlyNetConsent: s.earlyNetConsent,
    debtor: s.debtor,
    creditor: s.creditor,
    nonce: BigInt(s.nonce),
    registry: s.registry,
    chainId: BigInt(s.chainId),
  };
}

export type PreCheckActionResult = { ok: true } | { ok: false; error: string };

export async function preCheck(invoice: SerializableInvoice, debtorSignature: Hex, creditorSignature: Hex): Promise<PreCheckActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const result = await preCheckAttestation({
    invoice: toInvoiceAttestation(invoice),
    debtorSignature,
    creditorSignature,
    rateLimitKey: session.address,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true };
}

export type RecordActionResult = { ok: true; invoiceRef: string } | { ok: false; error: string };

export async function record(txHash: Hex): Promise<RecordActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const result = await recordRegistration(txHash);
  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true, invoiceRef: result.invoiceRef };
}

/// Writes only if the signed-in party is one of the two named on the document — never trusts a
/// client-supplied `createdBy`.
export type SaveDocumentResult = { ok: true } | { ok: false; error: string };

export async function saveInvoiceDocument(invoiceRef: string, document: CanonicalInvoiceDocument): Promise<SaveDocumentResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const isParty =
    session.address.toLowerCase() === document.debtor.toLowerCase() ||
    session.address.toLowerCase() === document.creditor.toLowerCase();
  if (!isParty) return { ok: false, error: "You're not a party to this invoice." };

  await upsertInvoiceDocument({
    invoiceRef,
    description: document.description,
    debtor: document.debtor,
    creditor: document.creditor,
    amountUsdc: document.amountUsdc,
    maturity: document.maturity,
    createdBy: session.address,
  });
  return { ok: true };
}

/// Reads only if the signed-in party is one of the two named on the stored document — returns
/// "not found" rather than "forbidden" for a non-party, so a lookup can't confirm a document
/// exists to someone who isn't named on it.
export type GetDocumentResult = { ok: true; description: string } | { ok: false; error: string };

export async function getInvoiceDocument(invoiceRef: string): Promise<GetDocumentResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const row = await getInvoiceDocumentByRef(invoiceRef);
  if (!row) return { ok: false, error: "Not found." };

  const isParty =
    session.address.toLowerCase() === row.debtor.toLowerCase() ||
    session.address.toLowerCase() === row.creditor.toLowerCase();
  if (!isParty) return { ok: false, error: "Not found." };

  return { ok: true, description: row.description };
}
