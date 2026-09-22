const VALUES = [
  {
    title: "Fail-safe by design",
    body: "A missing signature, a broken cycle, or the wrong network means the transaction simply reverts — never a silent partial state.",
  },
  {
    title: "Permissionless settlement",
    body: "Anyone can trigger settlement for a valid cycle. Contraflow never gates who's allowed to cancel debt that's genuinely cancellable.",
  },
  {
    title: "Fully on-chain",
    body: "Every figure you see — cancelled volume, gas paid, a receipt — comes from a real on-chain event, never a placeholder.",
  },
  {
    title: "Open and auditable",
    body: "Our contracts and source code are public. Verify anything we say here yourself.",
  },
];

export function Values() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">Our values</p>
        <h2 className="mt-3 font-serif-display text-4xl">The principles behind the protocol</h2>
        <p className="mt-4 text-muted">
          Fail-safe design, permissionless settlement, and nothing left unverifiable.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {VALUES.map((v) => (
          <div key={v.title} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
            <h3 className="text-lg font-medium">{v.title}</h3>
            <p className="mt-2 text-sm text-muted">{v.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
