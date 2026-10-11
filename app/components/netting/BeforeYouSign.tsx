"use client";

/// The review step before a party signs a certificate: what Contraflow does and doesn't check,
/// on-demand facts about the other parties in the loop (the same ones the history page shows),
/// and an explicit confirmation. Facts, not verdicts.

import { useState } from "react";
import { AddressRows } from "@/components/inspector/SignalsPanels";
import { Address as AddressText } from "@/components/ui/Address";
import { lookupAddressSignals, type AddressSignalsResult } from "@/src/app/app/history/actions";

export function BeforeYouSign({
  parties,
  me,
  reviewed,
  onReviewed,
}: {
  parties: string[];
  me: string;
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
}) {
  const [facts, setFacts] = useState<Record<string, AddressSignalsResult | "loading">>({});
  const others = [...new Set(parties.map((a) => a.toLowerCase()))].filter((a) => a !== me.toLowerCase());

  async function load() {
    setFacts(Object.fromEntries(others.map((a) => [a, "loading" as const])));
    await Promise.all(
      others.map(async (a) => {
        let result: AddressSignalsResult;
        try {
          result = await lookupAddressSignals(a);
        } catch {
          result = { ok: false, error: "Couldn't load facts right now." };
        }
        setFacts((current) => ({ ...current, [a]: result }));
      }),
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-white/10 p-4">
      <p className="text-sm font-medium">Before you sign</p>
      <p className="mt-1 text-xs text-muted">
        Contraflow checks that everyone agreed to these terms. It does not check that the work behind them was done. If
        either of your obligations is in question, dispute it: it is left out of this and every later loop until you
        withdraw the dispute.
      </p>
      {others.length > 0 && Object.keys(facts).length === 0 && (
        <button onClick={() => void load()} className="mt-3 text-xs text-gold hover:underline">
          Show facts about the other {others.length} {others.length === 1 ? "party" : "parties"}
        </button>
      )}
      {Object.keys(facts).length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {others.map((a) => {
            const entry = facts[a];
            return (
              <li key={a} className="rounded-lg border border-white/10 p-3 text-sm">
                <AddressText address={a} />
                {entry === "loading" || entry === undefined ? (
                  <p className="mt-1 text-xs text-muted">Loading…</p>
                ) : entry.ok ? (
                  <AddressRows signals={entry.signals} />
                ) : (
                  <p className="mt-1 text-xs text-muted">{entry.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={reviewed} onChange={(event) => onReviewed(event.target.checked)} className="mt-1" />
        <span>I&apos;ve reviewed my two obligations and I don&apos;t dispute them.</span>
      </label>
    </div>
  );
}
