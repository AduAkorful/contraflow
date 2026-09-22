"use server";

/// Server Action behind `/app/history`. Address lookup, deliberately not session-gated — this
/// path is meant to work for an auditor checking a counterparty without signing in at all.

import { reconcileAddress } from "../../../src/blockscout/reconcile";
import { isAddress } from "viem";

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
}

export type HistoryLookupResult =
  | { ok: true; invoices: HistoryInvoiceView[]; reconciled: boolean; reconcileError?: string }
  | { ok: false; error: string };

export async function lookupAddressHistory(address: string): Promise<HistoryLookupResult> {
  if (!isAddress(address)) {
    return { ok: false, error: "Not a valid address." };
  }

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
    };
  });

  return { ok: true, invoices: views, reconciled, reconcileError: error };
}
