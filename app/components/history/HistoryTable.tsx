"use client";

import { Address } from "../ui/Address";
import { Money } from "../ui/Money";
import { EurcQuote } from "../quote/EurcQuote";
import { ARC_TESTNET_CHAIN_ID } from "../../src/contracts/addresses";
import { usdcBaseUnits } from "../../src/format/money";
import { NETTING_STATUS_LABEL, nettingStatus } from "../../src/format/netting";
import { unifiedBalanceEnabled } from "../../src/kits/gatewayChains";
import { earlyNettingReview } from "../../src/format/signing";
import type { HistoryInvoiceView } from "../../app/app/history/actions";

const EXPLORER_BASE = "https://explorer.testnet.arc.io";

function stillOwed(inv: HistoryInvoiceView): boolean {
  const owed = inv.status === "settled" ? inv.remainingUsdc : inv.amountUsdc;
  const base = owed === null ? null : usdcBaseUnits(owed);
  return base !== null && base > 0n;
}

export function historyPartyActionFlags(opts: {
  viewingOwn: boolean;
  stillOwed: boolean;
  isDebtor: boolean;
  unifiedBalance: boolean;
}): { quote: boolean; bringUsdc: boolean } {
  return {
    quote: opts.viewingOwn && opts.stillOwed,
    bringUsdc: opts.viewingOwn && opts.stillOwed && opts.isDebtor && opts.unifiedBalance,
  };
}

function rowStatus(inv: HistoryInvoiceView, inLoop: boolean): { label: string; receiptHref: string | null } {
  const label = NETTING_STATUS_LABEL[nettingStatus(inv.amountUsdc, inv.status === "settled" ? inv.remainingUsdc : null)];
  const withLoop = inLoop && label === "Open" ? "Open · in a loop" : label;
  return { label: withLoop, receiptHref: inv.settleTxHash ? `/app/receipt/${inv.settleTxHash}` : null };
}

function PartyActions({ inv }: { inv: HistoryInvoiceView }) {
  const flags = historyPartyActionFlags({
    viewingOwn: true,
    stillOwed: stillOwed(inv),
    isDebtor: inv.role === "debtor",
    unifiedBalance: unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID),
  });
  if (!flags.quote && !flags.bringUsdc) return null;
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none px-2 py-1 text-muted" aria-label="More actions">
        ⋯
      </summary>
      <div className="absolute right-0 z-10 mt-1 min-w-48 rounded-lg border border-border-subtle bg-surface-1 p-2 text-xs shadow-lg">
        {flags.quote && <EurcQuote invoiceId={inv.invoiceRef} />}
        {flags.bringUsdc && (
          <a href="/app/balance" className="mt-2 block text-muted hover:underline">
            Bring USDC from another chain →
          </a>
        )}
      </div>
    </details>
  );
}

function TxLink({ inv }: { inv: HistoryInvoiceView }) {
  if (inv.settleTxHash) {
    return (
      <a href={`/app/receipt/${inv.settleTxHash}`} className="text-gold hover:underline">
        Receipt →
      </a>
    );
  }
  return (
    <a href={`${EXPLORER_BASE}/tx/${inv.registerTxHash}`} target="_blank" rel="noreferrer" className="text-muted hover:underline">
      View tx →
    </a>
  );
}

function StatusBadge({ inv, inLoop }: { inv: HistoryInvoiceView; inLoop: boolean }) {
  const { label, receiptHref } = rowStatus(inv, inLoop);
  return (
    <span className="rounded-md border border-border-input px-2 py-0.5 text-xs text-muted">
      {label}
      {!inv.earlyNetConsent ? ` · ${earlyNettingReview(inv.maturity, false)}` : ""}
      {label.startsWith("Partly netted") && receiptHref ? (
        <>
          {" "}
          ·{" "}
          <a href={receiptHref} className="text-gold hover:underline">
            receipt ↗
          </a>
        </>
      ) : null}
    </span>
  );
}

/// One row per invoice for the looked-up address. Below 640 px the rows stack as cards so the page
/// doesn't scroll sideways.
export function HistoryTable({
  invoices,
  address,
  loopInvoiceIds = [],
  viewingOwn = false,
}: {
  invoices: HistoryInvoiceView[];
  address: string;
  loopInvoiceIds?: string[];
  viewingOwn?: boolean;
}) {
  const inLoop = new Set(loopInvoiceIds.map((id) => id.toLowerCase()));
  return (
    <>
      <div className="mt-8 hidden overflow-x-auto rounded-card border border-border-subtle bg-surface-1 md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Invoices for {address}</caption>
          <thead>
            <tr className="border-b border-border-subtle text-xs text-faint">
              <th scope="col" className="px-4 py-3 font-medium">Counterparty</th>
              <th scope="col" className="px-4 py-3 font-medium">Direction</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Remaining</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Links</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {invoices.map((inv) => {
              const remaining = inv.status === "settled" ? inv.remainingUsdc : inv.amountUsdc;
              return (
                <tr key={inv.invoiceRef} className="align-top">
                  <td className="px-4 py-3.5">
                    <Address address={inv.counterparty} className="text-foreground" />
                  </td>
                  <td className="px-4 py-3.5 text-muted">{inv.role === "debtor" ? "Owes them" : "Owed by them"}</td>
                  <td className="px-4 py-3.5 text-right">
                    <Money value={inv.amountUsdc} />
                  </td>
                  <td className="px-4 py-3.5 text-right text-muted">{remaining === null ? "—" : <Money value={remaining} />}</td>
                  <td className="px-4 py-3.5">
                    <StatusBadge inv={inv} inLoop={inLoop.has(inv.invoiceRef.toLowerCase())} />
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-start gap-2 text-xs">
                      <TxLink inv={inv} />
                      {viewingOwn && <PartyActions inv={inv} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="mt-8 space-y-3 md:hidden">
        {invoices.map((inv) => {
          const remaining = inv.status === "settled" ? inv.remainingUsdc : inv.amountUsdc;
          return (
            <li key={inv.invoiceRef} className="rounded-card border border-border-subtle bg-surface-1 p-4">
              <div className="flex items-start justify-between gap-3">
                <Address address={inv.counterparty} className="text-foreground" />
                {viewingOwn && <PartyActions inv={inv} />}
              </div>
              <p className="mt-2 text-sm text-muted">
                {inv.role === "debtor" ? "Owes them" : "Owed by them"} · <Money value={inv.amountUsdc} />
                {remaining !== null && (
                  <>
                    {" "}
                    · remaining <Money value={remaining} />
                  </>
                )}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <StatusBadge inv={inv} inLoop={inLoop.has(inv.invoiceRef.toLowerCase())} />
                <TxLink inv={inv} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
