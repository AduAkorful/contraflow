"use server";

/// Server Action behind `/app/history`. Address lookup, deliberately not session-gated — this
/// path is meant to work for an auditor checking a counterparty without signing in at all.

import { reconcileAddress } from "@/src/blockscout/reconcile";
import { isAddress } from "viem";
import { getAddressSignals } from "@/src/inspector/load";
import { guardInspectorRequest, SIGNALS_UNAVAILABLE } from "@/src/inspector/requestGuard";
import type { AddressSignals } from "@/src/inspector/signals";
import { guardPublicRead } from "@/src/ratelimit/publicReadGuard";

export interface HistoryInvoiceView {
  invoiceRef: string;
  role: "debtor" | "creditor";
  counterparty: string;
  amountUsdc: string;
  status: "registered" | "settled";
  registerTxHash: string;
  settleTxHash: string | null;
  wNetUsdc: string | null;
  remainingUsdc: string | null;
  earlyNetConsent: boolean;
  maturity: string;
}

export type HistoryLookupResult =
  | { ok: true; invoices: HistoryInvoiceView[]; reconciled: boolean; reconcileError?: string }
  | { ok: false; error: string };

export async function lookupAddressHistory(address: string): Promise<HistoryLookupResult> {
  if (!isAddress(address)) {
    return { ok: false, error: "Not a valid address." };
  }

  const guard = await guardPublicRead("history");
  if (!guard.allowed) return { ok: false, error: guard.error };

  const { invoices, reconciled, error } = await reconcileAddress(address);

  const views: HistoryInvoiceView[] = invoices.map((inv) => {
    const isDebtor = inv.debtor.toLowerCase() === address.toLowerCase();
    return {
      invoiceRef: inv.invoiceRef,
      role: isDebtor ? "debtor" : "creditor",
      counterparty: isDebtor ? inv.creditor : inv.debtor,
      amountUsdc: inv.amountUsdc,
      status: inv.status,
      registerTxHash: inv.registerTxHash,
      settleTxHash: inv.settleTxHash,
      wNetUsdc: inv.wNetUsdc,
      remainingUsdc: inv.remainingUsdc,
      earlyNetConsent: inv.earlyNetConsent,
      maturity: inv.maturity,
    };
  });

  return { ok: true, invoices: views, reconciled, reconcileError: error };
}

export type AddressSignalsResult = { ok: true; signals: AddressSignals } | { ok: false; error: string };

/// Loaded separately from, and after, the invoice list, so a slow or failing explorer never delays
/// or breaks the history itself.
export async function lookupAddressSignals(address: string): Promise<AddressSignalsResult> {
  if (!isAddress(address)) return { ok: false, error: "Not a valid address." };

  const guard = await guardInspectorRequest("address");
  if (!guard.allowed) return { ok: false, error: guard.error };

  try {
    return { ok: true, signals: await getAddressSignals(address) };
  } catch {
    return { ok: false, error: SIGNALS_UNAVAILABLE };
  }
}
