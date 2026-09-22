"use server";

/// Server Actions behind `/app/attest` — plans/21-real-mode-attest-flow.md. Every action that acts
/// "on behalf of the signed-in party" derives the address from the verified session
/// (`getSession()`), never from a client-supplied parameter — same discipline plan 14 states for
/// `/app/history`, applied here too (design decision 2).

import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { getSession } from "../../../src/session/getSession";
import { requestStarterGrant, grantAmountUsdc } from "../../../src/attest/starterGrant";
import { resolveNextNonce } from "../../../src/attest/nextNonce";
import { preCheckAttestation } from "../../../src/attest/precheck";
import { recordRegistration } from "../../../src/attest/record";
import type { InvoiceAttestation } from "../../../src/attest/signAttestation";

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

/// Deliberately NOT session-gated — this is the "catch a stale link before investing effort
/// signing" check plan 14 describes for Party B's landing page, meant to run *before* they've
/// connected or signed in at all. The nonce comparison itself reveals nothing sensitive (it's
/// derived from public on-chain events either way).
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
