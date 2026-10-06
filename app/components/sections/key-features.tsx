const FEATURES = [
  {
    title: "Invoices on Arc",
    body: "Both sides sign a USDC invoice with their own wallets before it's registered. When invoices form a loop, one transaction cancels the same amount off every one of them.",
  },
  {
    title: "Obligations in any currency",
    body: "Record what you owe and are owed in dollars, euros, cedis or any other currency. Obligation amounts never go onchain. Contraflow's servers can read them. Invoice amounts and parties are public on Arc.",
  },
  {
    title: "One certificate for the whole loop",
    body: "Everyone in the loop reviews their own obligations and signs one netting certificate. Once it's applied on Arc, the same debt can never be netted twice.",
  },
  {
    title: "A receipt for every settlement",
    body: "See the block, the transaction and exactly what changed for every invoice involved, all checkable on the Arc explorer.",
  },
  {
    title: "Check any certificate yourself",
    body: "Download your certificate and verify it against the ledger on Arc, in your own browser. Nothing is uploaded.",
  },
  {
    title: "Always know where you stand",
    body: "See which network you're on and what you're signing before you confirm anything.",
  },
];

export function KeyFeatures() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">Key features</p>
        <h2 className="mt-3 font-serif-display text-4xl">What the app covers</h2>
        <p className="mt-4 text-muted">
          From the first signature to a debt netted out and a record you can check.
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
