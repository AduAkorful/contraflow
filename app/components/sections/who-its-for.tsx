const AUDIENCES = [
  {
    title: "Ad-tech settlement",
    body: "Publishers, networks and buyers who owe each other in a loop at the end of a period, and would rather net than pay the circle in full.",
  },
  {
    title: "Supply-chain payables",
    body: "Suppliers and buyers who trade both ways, so the same money would leave and come back if every invoice were paid.",
  },
  {
    title: "Freight",
    body: "Carriers, forwarders and shippers with reciprocal charges that close a loop across a lane or a season.",
  },
] as const;

export function WhoItsFor() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-serif-display text-4xl">Who it&apos;s for</h2>
        <p className="mt-4 text-muted">
          Counterparties who already owe each other in a loop. Contraflow doesn&apos;t extend credit; it
          nets the debts that would only go round.
        </p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-3">
        {AUDIENCES.map((item) => (
          <div key={item.title} className="rounded-card border border-border-subtle bg-surface-1 p-6">
            <h3 className="text-lg font-medium">{item.title}</h3>
            <p className="mt-2 text-sm text-muted">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
