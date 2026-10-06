import Link from "next/link";
import { MarketingPage } from "@/components/marketing/MarketingPage";
import { pageMeta } from "@/src/site/pageMeta";

export const metadata = pageMeta(
  "/about",
  "About",
  "Why Contraflow exists: so money that would only go round in a circle never has to move.",
);

export default function AboutPage() {
  return (
    <MarketingPage>
      <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
        <h1 className="font-serif-display text-5xl leading-[1.05]">Why we built Contraflow</h1>
        <p className="mx-auto mt-6 max-w-xl text-muted">
          So money that would only go round in a circle never has to move.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-8">
        <h2 className="font-serif-display text-3xl">The problem</h2>
        <p className="mt-4 text-muted">
          Circular debt is common wherever counterparties trade with each other in a loop. Each
          party pays and gets paid in full, when the debts could net out directly. That shape shows
          up in ad-tech settlement, supply-chain payables and freight.
        </p>
        <p className="mt-4 text-muted">
          Contraflow records each debt with both parties&apos; signatures, finds the loops among them,
          and nets each loop in one step: a single transaction for USDC invoices on Arc, or one
          certificate signed by everyone for obligations in any currency. Contraflow never holds
          your funds and takes no cut.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-8">
        <h2 className="font-serif-display text-3xl">What we&apos;re building toward</h2>
        <p className="mt-4 text-muted">
          Let counterparties who owe each other in a loop net it out directly, without a central
          clearer and without moving money they&apos;d only get straight back.
        </p>
        <p className="mt-8">
          <Link href="/app" className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black">
            Start free
          </Link>
        </p>
      </section>
    </MarketingPage>
  );
}
