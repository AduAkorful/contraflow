import { formatAmount } from "../netting/currency";
import { formatAddress } from "./address";
import { formatUsdc } from "./money";

/// Same UTC date printing as `components/netting/format.ts`, kept here so this module stays
/// importable from tests and from client hooks without pulling the UI layer.
function displayDate(value: string): string {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number(value) * 1000;
  return new Date(ms).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function displayMinorAmount(minor: string, currency: string): string {
  try {
    const major = formatAmount(BigInt(minor), currency);
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(major as unknown as number);
  } catch {
    return `${currency} ${minor}`;
  }
}

/// Last-step sentence shown before a party signs, and used as the Privy embedded-wallet popup
/// description so the prompt isn't raw typed-data fields.

export function earlyNettingHelper(maturityDate: string, on: boolean): string {
  if (on) return "On: this can join a loop before its due date.";
  return `Off: it can't be netted until ${displayDate(maturityDate)}.`;
}

export function earlyNettingReview(maturity: string, on: boolean): string {
  if (on) return "Can be netted: anytime before its due date";
  return `Can be netted: only after ${displayDate(maturity)} (early netting off)`;
}

export function signingConfirmation(params: {
  youOwe: boolean;
  amountDisplay: string;
  counterparty: string;
  due: string;
  earlyNetConsent: boolean;
}): string {
  const verb = params.youOwe ? "you owe" : "you're owed";
  const prep = params.youOwe ? "to" : "from";
  const early = params.earlyNetConsent ? "on" : "off";
  return `You're confirming: ${verb} ${params.amountDisplay} ${prep} ${formatAddress(params.counterparty)}, due ${displayDate(params.due)}. Early netting: ${early}.`;
}

export function invoiceSigningConfirmation(params: {
  youOwe: boolean;
  amountUsdc: string | bigint;
  counterparty: string;
  maturity: string | bigint;
  earlyNetConsent: boolean;
}): string {
  const due = typeof params.maturity === "bigint" ? params.maturity.toString() : params.maturity;
  return signingConfirmation({
    youOwe: params.youOwe,
    amountDisplay: formatUsdc(params.amountUsdc),
    counterparty: params.counterparty,
    due,
    earlyNetConsent: params.earlyNetConsent,
  });
}

export function obligationSigningConfirmation(params: {
  youOwe: boolean;
  amountMinor: string;
  currency: string;
  counterparty: string;
  maturity: string;
  earlyNetConsent: boolean;
}): string {
  return signingConfirmation({
    youOwe: params.youOwe,
    amountDisplay: displayMinorAmount(params.amountMinor, params.currency),
    counterparty: params.counterparty,
    due: params.maturity,
    earlyNetConsent: params.earlyNetConsent,
  });
}

export function certificateSigningConfirmation(params: {
  wNet: string;
  currency: string;
  parties: number;
}): string {
  return `You're confirming: this nets ${displayMinorAmount(params.wNet, params.currency)} off each of ${params.parties} obligations in the loop.`;
}

export function typedDataUiRoute(walletClientType: string | undefined | null): "privy" | "wagmi" {
  return walletClientType === "privy" || walletClientType === "privy-v2" ? "privy" : "wagmi";
}
