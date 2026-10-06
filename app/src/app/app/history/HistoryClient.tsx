"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { HistoryTable } from "@/components/history/HistoryTable";
import { lookupAddressHistory, lookupAddressSignals, type AddressSignalsResult, type HistoryInvoiceView } from "./actions";
import {
  AddressSignalsPanel,
  SignalsLoading,
  SignalsUnavailable,
} from "@/components/inspector/SignalsPanels";

const SIGNALS_TITLE = "Onchain signals";
const SettleLoopCard = dynamic(() => import("@/components/settle/SettleLoopCard").then((m) => m.SettleLoopCard), {
  ssr: false,
});


/// `initialAddress` is the `?address=` link, or else the signed-in address. It is looked up on arrival
/// so a shared link opens on the result, and every search updates the URL so the result can be shared.
export function HistoryClient({ initialAddress, sessionAddress }: { initialAddress: string; sessionAddress: string | null }) {
  const router = useRouter();
  const [address, setAddress] = useState(initialAddress);
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<HistoryInvoiceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signals, setSignals] = useState<AddressSignalsResult | "loading" | null>(null);
  const [loopIds, setLoopIds] = useState<string[]>([]);
  const latestLookup = useRef(0);
  const viewingOwn = Boolean(sessionAddress && address.trim().toLowerCase() === sessionAddress.toLowerCase());

  async function search(value: string = address) {
    const lookedUp = value.trim();
    if (lookedUp.length === 0) return;
    router.replace(`/app/history?address=${encodeURIComponent(lookedUp)}`, { scroll: false });
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

  useEffect(() => {
    if (initialAddress) void search(initialAddress);
    // Runs once on arrival: later searches are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <section className="mx-auto max-w-5xl min-w-0 overflow-x-clip px-4 pb-10 pt-10 sm:px-6">
        <h1 className="heading-1">Invoice history</h1>
        <p className="mt-4 max-w-2xl text-muted">
          Look up any address&apos;s invoices on Arc testnet — no sign-in needed. Useful for
          checking a counterparty, or your own address after running{" "}
          <a href="/app/demo" className="text-gold hover:underline">
            the demo
          </a>
          .
        </p>

        <div className="mt-6 flex max-w-2xl min-w-0 flex-col gap-3 sm:flex-row">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            aria-label="Address to look up"
            placeholder="0x..."
            className="min-w-0 flex-1 rounded-lg border border-border-input bg-surface-1 px-4 py-3 text-sm font-mono focus:border-focus"
          />
          <button
            onClick={() => search()}
            disabled={loading || address.trim().length === 0}
            className="rounded-lg bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
          >
            {loading ? "Looking up..." : "Look up"}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        {loading && (
          <div className="mt-8 divide-y divide-border-subtle rounded-card border border-border-subtle bg-surface-1" aria-hidden="true">
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

        {viewingOwn && sessionAddress && (
          <div className="mt-8">
            <SettleLoopCard sessionAddress={sessionAddress} onLoopIds={setLoopIds} />
          </div>
        )}

        {invoices && invoices.length > 0 && (
          <HistoryTable
            invoices={invoices}
            address={address.trim()}
            loopInvoiceIds={viewingOwn ? loopIds : []}
            viewingOwn={viewingOwn}
          />
        )}

        {(signals === "loading" || signals) && (
          <details className="mt-8">
            <summary className="cursor-pointer text-sm text-muted">Onchain signals</summary>
            {signals === "loading" && <SignalsLoading title={SIGNALS_TITLE} />}
            {signals && signals !== "loading" && !signals.ok && (
              <SignalsUnavailable title={SIGNALS_TITLE} message={signals.error} />
            )}
            {signals && signals !== "loading" && signals.ok && <AddressSignalsPanel signals={signals.signals} />}
          </details>
        )}
      </section>
    </>
  );
}
