const FAQS = [
  {
    q: "What is multilateral netting?",
    a: "When A owes B, B owes C, and C owes A on the same terms, that's a closed cycle — everyone can cancel their debt without any cash moving. Contraflow finds those cycles and cancels them in one transaction.",
  },
  {
    q: "Is this live, and on which network?",
    a: "Contracts are live and independently verifiable on Arc — check the explorer link and transaction hashes shown in the app rather than taking this page's word for it.",
  },
  {
    q: "Is Contraflow free to use?",
    a: "Yes — netting doesn't cost anything on Contraflow. You only pay standard Arc network gas.",
  },
  {
    q: "Can the protocol's rules change in the future?",
    a: "Yes. Contraflow's contracts can be upgraded by the team, who hold a single administrative key rather than a multisig or DAO vote. We disclose this openly instead of claiming the contracts are immutable — see our Terms for details.",
  },
  {
    q: "What happens if a counterparty never signs?",
    a: "Nothing. An invoice with only one signature never registers on-chain — there's no dispute process to trigger because nothing was ever committed.",
  },
];

export function Faq() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">FAQs</p>
        <h2 className="mt-3 font-serif-display text-4xl">Need more details?</h2>
        <p className="mt-4 text-muted">Learn how netting works and what Contraflow does and doesn't claim.</p>
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
