import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

const JOURNEYS = [
  {
    number: "1",
    title: "Know where you stand",
    body: "Which network you're on, and which currency you're spending, shown before any transaction.",
  },
  {
    number: "2",
    title: "Sign",
    body: "Both the debtor and the creditor sign the invoice with their own wallet before it's recorded on-chain.",
  },
  {
    number: "3",
    title: "Find a cycle",
    body: "See exactly which invoices form a closed cycle and how much would cancel — before you commit to anything.",
  },
  {
    number: "4",
    title: "Cancel it",
    body: "Submit the transaction and see the result — success, or a clear reason why not — with a link to it on the Arc explorer.",
  },
  {
    number: "5",
    title: "Get a quote",
    body: "See a live exchange rate for anything left over, clearly marked as a quote — it never becomes a real trade without your say.",
  },
  {
    number: "6",
    title: "Get a receipt",
    body: "See the block, the transaction, and exactly what changed for every invoice involved — proof the cycle really cleared on-chain.",
  },
];

const TRUST = [
  {
    title: "Fails safely",
    body: "A missing signature, a broken cycle, or the wrong network — the transaction simply doesn't go through. Nothing half-completes.",
  },
  {
    title: "Anyone can settle",
    body: "Cancelling a valid cycle isn't gated behind us — anyone can trigger it once it's ready.",
  },
  {
    title: "Upgradeable, and we say so",
    body: "The team can upgrade these contracts using a single administrative key. We disclose that plainly rather than claim the contracts can never change — see our Terms.",
  },
  {
    title: "Real numbers only",
    body: "Every figure the app shows — cancelled volume, gas paid, a receipt — comes from an actual transaction, never a sample or a mock.",
  },
];

export default function FeaturesPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
          <h1 className="font-serif-display text-5xl leading-[1.05]">
            From a signature to a receipt
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-muted">
            Six steps, everything the app covers.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-gold">
            Core journeys
          </p>
          <h2 className="mt-3 text-center font-serif-display text-3xl">
            What the app covers
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-muted">
            Not a fixed page count — every capability below shows up somewhere in the app.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {JOURNEYS.map((j) => (
              <div key={j.number} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
                <span className="font-serif-display text-2xl text-gold">{j.number}</span>
                <h3 className="mt-2 font-medium">{j.title}</h3>
                <p className="mt-2 text-sm text-muted">{j.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-gold">
            Trust & disclosure
          </p>
          <h2 className="mt-3 text-center font-serif-display text-3xl">
            How Contraflow is built
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-muted">
            We'd rather disclose a real limitation than make a claim we can't back up.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {TRUST.map((t) => (
              <div key={t.title} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
                <h3 className="font-medium">{t.title}</h3>
                <p className="mt-2 text-sm text-muted">{t.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
