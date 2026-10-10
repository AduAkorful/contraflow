"use client";

/// Protocol-wide totals counted from contract events. Shown on Overview, collapsed.
/// If the stats can't be loaded it shows no figures at all: a zero here would be a false statement,
/// not a placeholder.

import { useEffect, useState } from "react";
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
      {unit && <span className="ml-1.5 text-sm font-normal text-muted">{unit}</span>}
    </span>
  );
}

function Loaded({ view, variant }: { view: StatsView; variant: "headline" | "full" }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border-subtle bg-border-subtle lg:grid-cols-4">
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
        <div className="mt-4 space-y-px" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="animate-skeleton h-12 rounded-card" />
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
