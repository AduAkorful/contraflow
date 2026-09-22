"use client";

import { useState } from "react";
import { SiteNav } from "../../../components/site-nav";
import { SiteFooter } from "../../../components/site-footer";
import { lookupAddressHistory, type HistoryInvoiceView } from "./actions";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const EXPLORER_BASE = "https://explorer.testnet.arc.io";

export default function HistoryPage() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<HistoryInvoiceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    setInvoices(null);
    const result = await lookupAddressHistory(address.trim());
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInvoices(result.invoices);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-2xl px-6 pb-10 pt-10">
          <h1 className="font-serif-display text-4xl leading-[1.05]">Invoice history</h1>
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
              className="flex-1 rounded-pill border border-white/15 bg-white/[0.02] px-4 py-3 text-sm font-mono outline-none focus:border-gold/50"
            />
            <button
              onClick={search}
              disabled={loading || address.trim().length === 0}
              className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02] disabled:opacity-40"
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
                      <span className="font-mono text-foreground/90">{shortAddr(inv.counterparty)}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      ${inv.amountUsdc}
                      {inv.status === "settled" && inv.remainingUsdc !== null && (
                        <> · now ${inv.remainingUsdc} remaining</>
                      )}
                    </p>
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
