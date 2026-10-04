const STEPS = [
  {
    number: "1",
    title: "Sign",
    body: "You and your counterparty both sign each debt with your own wallets: a USDC invoice on Arc, or an obligation in the currency you actually invoice in.",
  },
  {
    number: "2",
    title: "Find the loop",
    body: "Contraflow finds closed loops of debt between parties and shows you exactly how much nets off before you commit to anything.",
  },
  {
    number: "3",
    title: "Net it",
    body: "One transaction cancels a loop of invoices. For obligations, one certificate signed by everyone in the loop is recorded on Arc, so the same debt can never be netted twice.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">How it works</p>
        <h2 className="mt-3 font-serif-display text-4xl">How netting works</h2>
        <p className="mt-4 text-muted">
          From two signatures to a loop of debt netted out, in three steps.
        </p>
      </div>

      <div className="mt-12 grid gap-8 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.number} className="text-center sm:text-left">
            <span className="heading-1 text-gold">{s.number}</span>
            <h3 className="mt-3 text-lg font-medium">{s.title}</h3>
            <p className="mt-2 text-sm text-muted">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
