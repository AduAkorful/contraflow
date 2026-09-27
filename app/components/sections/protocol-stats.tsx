import { ProtocolStats } from "../stats/ProtocolStats";

export function ProtocolStatsSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">Protocol activity</p>
        <h2 className="mt-3 font-serif-display text-3xl sm:text-4xl">What&apos;s been netted so far</h2>
      </div>
      <div className="mt-10">
        <ProtocolStats variant="headline" />
      </div>
    </section>
  );
}
