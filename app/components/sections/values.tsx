const VALUES = [
  {
    title: "Fail-safe by design",
    body: "A missing signature, a broken loop or the wrong network means nothing is recorded. There's never a silent partial state.",
  },
  {
    title: "Permissionless settlement",
    body: "Anyone can trigger settlement for a valid loop. Contraflow never gates who's allowed to cancel debt that genuinely cancels.",
  },
  {
    title: "Real figures only",
    body: "Every figure you see, from the protocol stats to a receipt, comes from a real onchain event, never a placeholder.",
  },
  {
    title: "Amounts stay offchain",
    body: "Obligations are only ever shown to their two parties, and their amounts never go onchain. Onchain, only the participating addresses and a blinded record of each netting are public.",
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
