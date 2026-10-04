"use client";

import { useRef, useState } from "react";
import { SiteNav } from "../../../components/site-nav";
import { SiteFooter } from "../../../components/site-footer";
import { Address } from "../../../components/ui/Address";
import { Money } from "../../../components/ui/Money";
import { EurcQuote } from "../../../components/quote/EurcQuote";
import { ARC_TESTNET_CHAIN_ID } from "../../../src/contracts/addresses";
import { unifiedBalanceEnabled } from "../../../src/kits/gatewayChains";
import { lookupAddressHistory, lookupAddressSignals, type AddressSignalsResult, type HistoryInvoiceView } from "./actions";
import {
  AddressSignalsPanel,
  SignalsLoading,
  SignalsUnavailable,
} from "../../../components/inspector/SignalsPanels";

const SIGNALS_TITLE = "Onchain signals";


const EXPLORER_BASE = "https://explorer.testnet.arc.io";

function stillOwed(inv: HistoryInvoiceView): boolean {
  const owed = inv.status === "settled" ? inv.remainingUsdc : inv.amountUsdc;
  return owed !== null && Number(owed) > 0;
}

export default function HistoryPage() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<HistoryInvoiceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signals, setSignals] = useState<AddressSignalsResult | "loading" | null>(null);
  const latestLookup = useRef(0);

  async function search() {
    const lookedUp = address.trim();
    const lookupId = ++latestLookup.current;
    setLoading(true);
    setError(null);
    setInvoices(null);
    setSignals(null);
    const result = await lookupAddressHistory(lookedUp);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInvoices(result.invoices);

    setSignals("loading");
    const signalsResult = await lookupAddressSignals(lookedUp);
    // A newer search may have started while signals loaded; never show one address's signals
    // under another's history.
    if (lookupId === latestLookup.current) setSignals(signalsResult);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-2xl px-6 pb-10 pt-10">
          <h1 className="heading-1">Invoice history</h1>
          <p className="mt-4 text-muted">
            Look up any address&apos;s invoices on Arc testnet — no sign-in needed. Useful for
            checking a counterparty, or your own address after running{" "}
            <a href="/app/demo" className="text-gold hover:underline">
              the demo
            </a>
            .
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="0x..."
              className="flex-1 rounded-pill border border-border-input bg-surface-1 px-4 py-3 text-sm font-mono focus:border-focus"
            />
            <button
              onClick={search}
              disabled={loading || address.trim().length === 0}
              className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
            >
              {loading ? "Looking up..." : "Look up"}
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {loading && (
            <div className="mt-8 divide-y divide-white/10 rounded-card border border-white/10 bg-white/[0.02]" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex-1">
                    <div className="animate-skeleton h-3.5 w-40 rounded" />
                    <div className="animate-skeleton mt-2 h-3 w-24 rounded" />
                  </div>
                  <div className="animate-skeleton h-6 w-16 rounded-pill" />
                </div>
              ))}
            </div>
          )}

          {signals === "loading" && <SignalsLoading title={SIGNALS_TITLE} />}
          {signals && signals !== "loading" && !signals.ok && (
            <SignalsUnavailable title={SIGNALS_TITLE} message={signals.error} />
          )}
          {signals && signals !== "loading" && signals.ok && <AddressSignalsPanel signals={signals.signals} />}

          {invoices && invoices.length === 0 && (
            <p className="mt-8 text-center text-sm text-muted">No invoices found for this address.</p>
          )}

          {invoices && invoices.length > 0 && (
            <div className="mt-8 divide-y divide-white/10 rounded-card border border-white/10 bg-white/[0.02]">
              {invoices.map((inv) => (
                <div key={inv.invoiceRef} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm">
                      {inv.role === "debtor" ? "Owed to" : "Owed by"}{" "}
                      <Address address={inv.counterparty} className="text-foreground/90" />
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      <Money value={inv.amountUsdc} />
                      {inv.status === "settled" && inv.remainingUsdc !== null && (
                        <> · now <Money value={inv.remainingUsdc} /> remaining</>
                      )}
                    </p>
                    {stillOwed(inv) && <EurcQuote invoiceId={inv.invoiceRef} className="mt-1.5" />}
                    {stillOwed(inv) && inv.role === "debtor" && unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID) && (
                      <a href="/app/balance" className="mt-1 inline-block text-xs text-muted hover:underline">
                        Bring USDC from another chain →
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span
                      className={`rounded-pill border px-3 py-1 ${
                        inv.status === "settled" ? "border-gold/30 bg-gold/10 text-gold" : "border-white/15 text-muted"
                      }`}
                    >
                      {inv.status}
                    </span>
                    {inv.settleTxHash ? (
                      <a href={`/app/receipt/${inv.settleTxHash}`} className="text-gold hover:underline">
                        Receipt →
                      </a>
                    ) : (
                      <a
                        href={`${EXPLORER_BASE}/tx/${inv.registerTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted hover:underline"
                      >
                        View tx →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
