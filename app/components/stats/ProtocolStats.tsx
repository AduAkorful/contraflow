"use client";

/// Protocol-wide totals counted from contract events. Shown on the home page.
/// If the stats can't be loaded it shows no figures at all: a zero here would be a false statement,
/// not a placeholder. While the tab is visible it asks again every 30 seconds, so a change onchain
/// shows within about half a minute; a failed re-ask keeps the figures already shown (their own
/// "as of" and out-of-date note stay true), and numbers change in place without animation.

import { useEffect, useId, useState } from "react";
import { loadProtocolStats, type ProtocolStatsResult } from "../../src/app/app/stats/actions";
import type { StatTile, StatsView } from "../../src/stats/view";

/// "120.00 USDC" reads better as a figure with a quiet unit, and it keeps the figure on one line.
function splitUnit(value: string): { figure: string; unit: string | null } {
  const match = /^(.*\S)\s+(USDC)$/.exec(value);
  return match ? { figure: match[1]!, unit: match[2]! } : { figure: value, unit: null };
}

function Figure({ tile, className }: { tile: StatTile; className: string }) {
  const { figure, unit } = splitUnit(tile.value);
  return (
    <span className={className} title={tile.exact} aria-label={`${tile.label}: ${tile.exact}`}>
      {figure}
      {unit && <span className="text-sm font-normal text-muted">{` ${unit}`}</span>}
    </span>
  );
}

function Loaded({ view, variant }: { view: StatsView; variant: "headline" | "full" }) {
  const [howOpen, setHowOpen] = useState(false);
  const howId = useId();
  return (
    <div>
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border-subtle bg-border-subtle min-[460px]:grid-cols-2 lg:grid-cols-3 min-[460px]:[&>div:last-child:nth-child(odd)]:col-span-2 lg:[&>div:last-child:nth-child(odd)]:col-span-1">
        {view.headline.map((tile) => (
          <div key={tile.label} className="bg-surface-1 p-5">
            <dt className="text-xs text-muted">{tile.label}</dt>
            <dd className="mt-2">
              <Figure tile={tile} className="block text-2xl font-semibold tabular-nums" />
              {tile.note ? <p className="mt-2 text-xs leading-relaxed text-muted">{tile.note}</p> : null}
            </dd>
          </div>
        ))}
      </dl>

      {variant === "full" && (
        <dl className="mt-4 divide-y divide-border-subtle rounded-card border border-border-subtle bg-surface-1">
          {view.detail.map((tile) => (
            <div key={tile.label} className="flex items-baseline justify-between gap-6 px-5 py-3">
              <div className="min-w-0">
                <dt className="text-sm">{tile.label}</dt>
                {tile.note ? <p className="mt-0.5 text-xs text-muted">{tile.note}</p> : null}
              </div>
              <dd className="shrink-0 text-right">
                <Figure tile={tile} className="text-base tabular-nums" />
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 space-y-2 text-xs leading-relaxed text-muted">
        {view.staleness && (
          <p role="status" className="text-center font-medium text-gold">
            {view.staleness}
          </p>
        )}
        <p className="text-center" title={`As of ${view.asOf}${view.since ? `, counting since ${view.since}` : ""}`}>
          {view.chainName}
          {view.contracts.map((c) => (
            <span key={c.label}>
              {" · "}
              {c.url ? (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="tap-inline text-gold underline">
                  {c.label}
                </a>
              ) : (
                c.label
              )}
            </span>
          ))}
          {" · "}
          <button
            type="button"
            aria-expanded={howOpen}
            aria-controls={howId}
            onClick={() => setHowOpen((o) => !o)}
            className="tap-inline text-gold underline"
          >
            How these are counted
          </button>
        </p>
        {howOpen && (
          <ul id={howId} className="mx-auto max-w-2xl list-disc space-y-1 pl-5 text-left">
            <li>Invoices registered and face value: every invoice registered with the Registry.</li>
            <li>
              Value netted: the total each settlement reduced USDC invoice balances by, across every invoice in the
              loop.
            </li>
            <li>
              Loops settled: invoice loops settled through the Settler, plus netting certificates applied to the
              Netting ledger. Settlement reduces balances in place, so no tokens move.
            </li>
            <li>
              Certificates net obligations in other currencies, kept offchain. They add to loops settled, but their
              amounts never go onchain, so they aren&apos;t in value netted.
            </li>
            <li>
              Every event counts, including our own test runs, so anyone can recount these
              figures from the chain{view.since ? ` (counting since ${view.since})` : ""}.
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

function Skeleton({ variant }: { variant: "headline" | "full" }) {
  return (
    <div aria-busy="true" aria-label="Protocol stats, loading">
      <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 sm:gap-4 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="animate-skeleton h-[104px] rounded-card" />
        ))}
      </div>
      {variant === "full" && (
        <div className="mt-4 space-y-px" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="animate-skeleton h-12 rounded-card" />
          ))}
        </div>
      )}
    </div>
  );
}

/// How often an open, visible page asks for fresh figures.
export const STATS_POLL_MS = 30_000;

export function ProtocolStats({ variant }: { variant: "headline" | "full" }) {
  const [result, setResult] = useState<ProtocolStatsResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastAt = 0;

    async function load() {
      lastAt = Date.now();
      try {
        const next = await loadProtocolStats();
        if (cancelled) return;
        // A failed re-ask must not replace figures that were already shown.
        setResult((prev) => (next.ok || !prev || !prev.ok ? next : prev));
      } catch {
        if (cancelled) return;
        setResult((prev) => prev ?? { ok: false, error: "Stats are unavailable right now." });
      }
    }

    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, STATS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastAt >= STATS_POLL_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!result) return <Skeleton variant={variant} />;
  if (!result.ok) {
    return (
      <p className="rounded-card border border-white/10 bg-white/[0.02] p-5 text-sm text-muted" role="status">
        {result.error}
      </p>
    );
  }
  return <Loaded view={result.view} variant={variant} />;
}
