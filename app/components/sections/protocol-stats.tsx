import { ProtocolStats } from "../stats/ProtocolStats";

/// Compact strip of the protocol's real, counted totals, below the explanation rather than ahead of it.
export function ProtocolStatsSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-14" aria-labelledby="live-on-arc-heading">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="live-on-arc-heading" className="text-sm font-semibold">
          Live on Arc
        </h2>
        <p className="text-xs text-faint">Counted from the contracts&apos; events</p>
      </div>
      <ProtocolStats variant="headline" />
    </section>
  );
}
