import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";
import { Pricing } from "../../components/sections/pricing";

const COST_NOTES = [
  { title: "Protocol fee", body: "$0. Contraflow doesn't take a cut when you net a cycle." },
  { title: "What you pay", body: "Arc network gas, priced in USDC — that's it." },
  { title: "No subscriptions", body: "No tiers, no monthly plan, no per-cycle toll." },
];

export default function PricingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-4xl px-6 pb-4 pt-10 text-center">
          <h1 className="font-serif-display text-5xl leading-[1.05]">Simple, transparent pricing</h1>
          <p className="mx-auto mt-6 max-w-xl text-muted">
            No subscriptions, no tiers. You only ever pay Arc network gas.
          </p>
        </section>

        <Pricing />

        <section className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-gold">
            The full picture
          </p>
          <h2 className="mt-3 text-center font-serif-display text-3xl">
            What "$0 fee" means
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-muted">
            Just the gas a transaction costs on Arc — nothing else.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {COST_NOTES.map((n) => (
              <div key={n.title} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
                <h3 className="font-medium text-gold">{n.title}</h3>
                <p className="mt-2 text-sm text-muted">{n.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
