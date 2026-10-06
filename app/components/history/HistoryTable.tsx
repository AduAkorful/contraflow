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

/// One row per invoice for the looked-up address. Scrolls sideways inside its box on a narrow screen
/// rather than squeezing the columns.
export function HistoryTable({ invoices, address, loopInvoiceIds = [] }: { invoices: HistoryInvoiceView[]; address: string; loopInvoiceIds?: string[] }) {
  const inLoop = new Set(loopInvoiceIds.map((id) => id.toLowerCase()));
  return (
    <div className="mt-8 overflow-x-auto rounded-card border border-border-subtle bg-surface-1">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
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
                  <span className="rounded-md border border-border-input px-2 py-0.5 text-xs text-muted">
                    {NETTING_STATUS_LABEL[nettingStatus(inv.amountUsdc, inv.status === "settled" ? inv.remainingUsdc : null)]}
                    {inLoop.has(inv.invoiceRef.toLowerCase()) ? " · in a loop" : ""}
                    {!inv.earlyNetConsent ? ` · ${earlyNettingReview(inv.maturity, false)}` : ""}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-col items-start gap-1.5 text-xs">
                    {inv.settleTxHash ? (
                      <a href={`/app/receipt/${inv.settleTxHash}`} className="text-gold hover:underline">
                        Receipt →
                      </a>
                    ) : (
                      <a href={`${EXPLORER_BASE}/tx/${inv.registerTxHash}`} target="_blank" rel="noreferrer" className="text-muted hover:underline">
                        View tx →
                      </a>
                    )}
                    {stillOwed(inv) && <EurcQuote invoiceId={inv.invoiceRef} />}
                    {stillOwed(inv) && inv.role === "debtor" && unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID) && (
                      <a href="/app/balance" className="text-muted hover:underline">
                        Bring USDC from another chain →
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
