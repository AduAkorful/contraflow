const FEATURES = [
  {
    title: "Always know where you stand",
    body: "See which network you're on and which currency you're spending before you confirm anything.",
  },
  {
    title: "Both sides sign",
    body: "Debtor and creditor each sign the invoice with their own wallet — no invoice goes on-chain with only one signature.",
  },
  {
    title: "See the cycle before you settle",
    body: "Review the exact amount and invoices involved in a closed cycle before you commit to cancelling it.",
  },
  {
    title: "Settle and get a receipt",
    body: "One transaction cancels the cycle. You get a quote for anything left over, and a receipt showing exactly what changed on-chain.",
  },
];

export function KeyFeatures() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">Key features</p>
        <h2 className="mt-3 font-serif-display text-4xl">What the app covers</h2>
        <p className="mt-4 text-muted">
          From signing an invoice to a verifiable on-chain receipt.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-card border border-white/10 bg-white/[0.02] p-8">
            <h3 className="text-lg font-medium">{f.title}</h3>
            <p className="mt-2 text-sm text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
