import { ProtocolStats } from "../stats/ProtocolStats";

/// Public totals counted from contract events. They live here and nowhere in the signed-in app,
/// where a user sees only their own details.
export function LiveStats() {
  return (
    <section id="live" className="scroll-mt-28 mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-serif-display text-4xl">Live on Arc</h2>
        <p className="mt-4 text-muted">
          Counted from the contracts&apos; public events, not from our database.
        </p>
      </div>
      <div className="mt-10">
        <ProtocolStats variant="headline" />
      </div>
    </section>
  );
}
