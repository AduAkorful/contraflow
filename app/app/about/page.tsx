import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

const SCOPE = [
  {
    title: "Mission",
    body: "Let counterparties who owe each other in a loop net it out directly, without a central clearer and without moving money they'd only get straight back.",
  },
  {
    title: "Invoices on Arc",
    body: "USDC invoices signed by both sides and registered on Arc. A loop of them cancels in one transaction that anyone can submit.",
  },
  {
    title: "Offchain obligations",
    body: "Debts in any currency, signed by both sides and kept offchain. A loop nets out with one certificate everyone signs, recorded on Arc so it can't be netted twice.",
  },
];

export default function AboutPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-10 text-center">
          <h1 className="font-serif-display text-5xl leading-[1.05]">
            Multilateral netting, built on Arc
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-muted">
            Contraflow finds loops of debt between counterparties and nets them out, so money that
            would only go round in a circle never has to move.
          </p>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-serif-display text-3xl">The problem</h2>
          <p className="mt-4 text-muted">
            Circular debt is common wherever counterparties trade with each other in a loop.
            Programmatic advertising settlement chains are one example, and the same shape shows up
            in supply-chain payables and freight. Each party pays and gets paid in full, when the
            debts could net out directly.
          </p>
          <p className="mt-4 text-muted">
            Contraflow records each debt with both parties' signatures, finds the loops among them,
            and nets each loop out in one step: a single transaction for USDC invoices on Arc, or
            one certificate signed by everyone for obligations in any currency. Contraflow never
            holds your funds and takes no cut.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-6 sm:grid-cols-3">
            {SCOPE.map((s) => (
              <div key={s.title} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
                <h3 className="font-medium text-gold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
