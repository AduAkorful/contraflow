import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

const SCOPE = [
  { title: "Mission", body: "Give counterparties a way to cancel circular debt without a central clearer, using only what's already true on-chain: two signatures and a permissionless settlement transaction." },
  { title: "What we are today", body: "An early, working version on Arc: sign an invoice, find a closed cycle, cancel it in one transaction." },
  { title: "What we're not (yet)", body: "A full clearinghouse, a licensed netting service, an ERP integration, or an automated FX engine. See our FAQ and Terms for specifics." },
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
            Contraflow finds closed cycles of invoices and cancels them in one transaction, so no
            USDC moves except gas.
          </p>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-serif-display text-3xl">The problem</h2>
          <p className="mt-4 text-muted">
            Circular debt is common wherever counterparties trade with each other in a loop —
            programmatic advertising settlement chains are our first example, but the same shape
            shows up in supply-chain payables and freight. Each party pays and gets paid in cash,
            when the debts could cancel out directly.
          </p>
          <p className="mt-4 text-muted">
            Contraflow represents each invoice as a bilaterally-signed on-chain attestation, looks
            for closed cycles among them, and lets anyone submit a single transaction that cancels
            the whole cycle at once — no custody, no netting agent taking a cut.
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
