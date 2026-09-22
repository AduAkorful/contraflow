const STEPS = [
  {
    number: "1",
    title: "Sign",
    body: "Both sides sign the invoice with their wallet. It's recorded on-chain once both signatures are in.",
  },
  {
    number: "2",
    title: "Find a cycle",
    body: "Contraflow looks for a closed loop of invoices whose debts would fully cancel — and shows you the amount before you commit to anything.",
  },
  {
    number: "3",
    title: "Cancel it",
    body: "One transaction clears every invoice in the cycle at once. No USDC moves except gas.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">How it works</p>
        <h2 className="mt-3 font-serif-display text-4xl">How netting works</h2>
        <p className="mt-4 text-muted">
          From two signatures to a cancelled cycle of debt, in three steps.
        </p>
      </div>

      <div className="mt-12 grid gap-8 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.number} className="text-center sm:text-left">
            <span className="font-serif-display text-3xl text-gold">{s.number}</span>
            <h3 className="mt-3 text-lg font-medium">{s.title}</h3>
            <p className="mt-2 text-sm text-muted">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
