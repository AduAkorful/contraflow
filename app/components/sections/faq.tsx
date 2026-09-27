const FAQS = [
  {
    q: "What is multilateral netting?",
    a: "When A owes B, B owes C and C owes A, that's a closed loop. Everyone's debt can be reduced by the same amount without any money moving. Contraflow finds those loops and nets them out.",
  },
  {
    q: "What's the difference between invoices and obligations?",
    a: "Invoices are USDC debts registered on Arc, and a loop of them cancels in one transaction. Obligations are debts in any currency that stay offchain: both parties sign them in Contraflow, and a loop nets out with one certificate everyone in it signs.",
  },
  {
    q: "Can the same debt be netted twice?",
    a: "No. Every applied certificate is recorded on Arc, and the ledger refuses any certificate that doesn't start from an obligation's current recorded state.",
  },
  {
    q: "Is Contraflow free to use?",
    a: "There's no protocol fee today. You only pay Arc network gas, and recording an obligation costs nothing at all.",
  },
  {
    q: "What happens if a counterparty never signs?",
    a: "Nothing. A debt with only one signature is never registered or netted, so there's nothing to dispute.",
  },
  {
    q: "Can the protocol's rules change?",
    a: "Yes. Contraflow's contracts are upgradeable by the team with a single administrative key, as our Terms set out.",
  },
];

export function Faq() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">FAQs</p>
        <h2 className="mt-3 font-serif-display text-4xl">Need more details?</h2>
        <p className="mt-4 text-muted">How netting works, and what to expect when you use it.</p>
      </div>

      <div className="mt-12 divide-y divide-white/10 rounded-card border border-white/10">
        {FAQS.map((item) => (
          <details key={item.q} className="group p-6">
            <summary className="cursor-pointer list-none text-sm font-medium">
              {item.q}
            </summary>
            <p className="mt-3 text-sm text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
