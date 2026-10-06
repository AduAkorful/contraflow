const FAQS = [
  {
    q: "What's the difference between invoices and obligations?",
    a: "Invoices are USDC debts registered on Arc, and a loop of them nets in one transaction. Obligations are debts in any currency that stay offchain: both parties sign them in Contraflow, and a loop nets out with one certificate everyone in it signs.",
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
        <h2 className="font-serif-display text-4xl">Questions</h2>
        <p className="mt-4 text-muted">How netting works, and what to expect when you use it.</p>
      </div>

      <div className="mt-12 divide-y divide-border-subtle rounded-card border border-border-subtle">
        {FAQS.map((item) => (
          <details key={item.q} className="group p-6">
            <summary className="cursor-pointer list-none text-sm font-medium">{item.q}</summary>
            <p className="mt-3 text-sm text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
