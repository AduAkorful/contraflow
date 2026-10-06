"use client";

/// Protocol-wide totals counted from contract events. Shown on `/app` (collapsed on Overview).
/// If the stats can't be loaded it shows no figures at all: a zero here would be a false statement,
/// not a placeholder.

import { useEffect, useState } from "react";
import { loadProtocolStats, type ProtocolStatsResult } from "../../app/app/stats/actions";
import type { StatTile, StatsView } from "../../src/stats/view";

function Tile({ tile, size }: { tile: StatTile; size: "lg" | "sm" }) {
  return (
    <div className="rounded-card border border-border-subtle bg-surface-1 p-5">
      <dt className="text-xs text-muted">{tile.label}</dt>
      <dd
        className={size === "lg" ? "mt-2 text-2xl font-semibold tabular-nums" : "mt-1.5 text-lg tabular-nums"}
        title={tile.exact}
        aria-label={`${tile.label}: ${tile.exact}`}
      >
        {tile.value}
        {tile.note ? <p className="mt-2 text-xs font-normal leading-relaxed text-muted">{tile.note}</p> : null}
      </dd>
    </div>
  );
}

function Loaded({ view, variant }: { view: StatsView; variant: "headline" | "full" }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {view.headline.map((tile) => (
          <Tile key={tile.label} tile={tile} size="lg" />
        ))}
      </dl>

      {variant === "full" && (
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:mt-4 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {view.detail.map((tile) => (
            <Tile key={tile.label} tile={tile} size="sm" />
          ))}
        </dl>
      )}

      <div className="mt-4 space-y-1.5 text-xs leading-relaxed text-muted">
        {view.demoNote && <p>{view.demoNote}</p>}
        {view.lowerBound && (
          <p>The full history was too long to read in one pass, so these figures are lower bounds.</p>
        )}
        <p>
          As of {view.asOf} · {view.chainName}
          {view.since && <> · since {view.since}</>} · counted from contract events:{" "}
          {view.contracts.map((c, i) => (
            <span key={c.label}>
              {i > 0 && " · "}
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="tap-inline text-gold underline"
              >
                {c.label}
              </a>
            </span>
          ))}
        </p>
        <details className="group">
          <summary className="tap-inline cursor-pointer text-gold underline">How these are counted</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Invoices registered and face value: every invoice registered with the Registry.</li>
            <li>
              Value netted: the total each settlement reduced invoice balances by, across every invoice in the
              loop.
            </li>
            <li>
              Loops settled: invoice loops settled through the Settler, plus netting certificates applied to the
              Netting ledger.
            </li>
            <li>
              Offchain obligations only ever contribute counts. Their amounts never go onchain, so they can&apos;t
              be totalled here.
            </li>
            <li>
              Anything sent from Contraflow&apos;s operator wallet, which runs the live demo and our own test runs,
              is counted separately.
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}

function Skeleton({ variant }: { variant: "headline" | "full" }) {
  return (
    <div aria-busy="true" aria-label="Protocol stats, loading">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="animate-skeleton h-[104px] rounded-card" />
        ))}
      </div>
      {variant === "full" && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:mt-4 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="animate-skeleton h-[84px] rounded-card" />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProtocolStats({ variant }: { variant: "headline" | "full" }) {
  const [result, setResult] = useState<ProtocolStatsResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProtocolStats()
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setResult({ ok: false, error: "Stats are unavailable right now." }));
    return () => {
      cancelled = true;
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
