const FEATURES = [
  {
    title: "Finds the cycle for you",
    body: "Three or more parties who owe each other in a loop — Contraflow finds the cycle automatically.",
  },
  {
    title: "Cancels the whole loop at once",
    body: "Every invoice in the cycle clears in a single transaction, or none of them do. No partial cancels.",
  },
  {
    title: "$0 protocol fee",
    body: "Netting your invoices costs nothing. You only ever pay Arc network gas.",
  },
  {
    title: "Fully verifiable",
    body: "Every transaction is public on the Arc explorer, and the source is open for anyone to audit.",
  },
];

export function WhyUs() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">Why us</p>
        <h2 className="mt-3 font-serif-display text-4xl">Why closed-cycle netting</h2>
        <p className="mt-4 text-muted">
          Built for counterparties who owe each other in a loop and want it gone in one transaction.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
            <h3 className="text-lg font-medium">{f.title}</h3>
            <p className="mt-2 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
