import Link from "next/link";
import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

export const metadata = { title: "Features" };


const INVOICES = [
  {
    number: "1",
    title: "Sign",
    body: "The debtor and creditor each sign the invoice with their own wallet. It's registered on Arc once both signatures are in.",
  },
  {
    number: "2",
    title: "Find a loop",
    body: "See exactly which invoices form a closed loop and how much would cancel, before you commit to anything.",
  },
  {
    number: "3",
    title: "Cancel it",
    body: "One transaction cancels the same amount off every invoice in the loop, with a link to it on the Arc explorer.",
  },
  {
    number: "4",
    title: "Get a receipt",
    body: "See the block, the transaction and exactly what changed for every invoice involved.",
  },
];

const OBLIGATIONS = [
  {
    number: "1",
    title: "Record it in any currency",
    body: "Record what you owe or are owed in the currency you actually invoice in, with a description that only you and your counterparty are shown.",
  },
  {
    number: "2",
    title: "Both sides sign",
    body: "Send a short link. It's shown only to your counterparty, after they sign in with the wallet it names, and their browser checks your signature before they sign.",
  },
  {
    number: "3",
    title: "One certificate per loop",
    body: "When obligations form a loop, everyone in it reviews their own obligations and signs one netting certificate.",
  },
  {
    number: "4",
    title: "Never netted twice",
    body: "Applying the certificate records a blinded state for each obligation on Arc. The same debt can't be netted again from an old state.",
  },
  {
    number: "5",
    title: "Keep your certificate",
    body: "Download your copy of the certificate. It holds your own obligations in full, and no one else's amounts.",
  },
  {
    number: "6",
    title: "Verify any certificate",
    body: "Check a certificate against the ledger on Arc, in your browser, without uploading it.",
    href: "/app/verify",
  },
];

const TRUST = [
  {
    title: "Fails safely",
    body: "A missing signature, a broken loop or the wrong network means nothing goes through. Nothing half-completes.",
  },
  {
    title: "Anyone can settle",
    body: "Cancelling a valid loop isn't gated behind us. Anyone can trigger it once it's ready.",
  },
  {
    title: "Real numbers only",
    body: "Every figure the app shows, from the protocol stats to a receipt, comes from an actual transaction, never a sample or a mock.",
  },
];

type Step = { number: string; title: string; body: string; href?: string };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <div className={`mt-12 grid gap-6 sm:grid-cols-2 ${steps.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      {steps.map((j) => (
        <div key={j.number} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
          <span className="font-serif-display text-2xl text-gold">{j.number}</span>
          <h3 className="mt-2 font-medium">{j.title}</h3>
          <p className="mt-2 text-sm text-muted">{j.body}</p>
          {j.href ? (
            <Link href={j.href} className="mt-3 inline-block text-sm text-gold hover:underline">
              Verify a certificate →
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function FeaturesPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
          <h1 className="font-serif-display text-5xl leading-[1.05]">
            Net what you owe and are owed
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-muted">
            Two ways to net out a loop of debt: USDC invoices on Arc, and obligations in any currency.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-gold">
            Invoices on Arc
          </p>
          <h2 className="mt-3 text-center font-serif-display text-3xl">
            From a signature to a receipt
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-muted">
            USDC invoices, registered on Arc and cancelled in place, with no USDC moving except gas.
          </p>
          <Steps steps={INVOICES} />
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-gold">
            Offchain obligations
          </p>
          <h2 className="mt-3 text-center font-serif-display text-3xl">
            Any currency, one certificate
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-muted">
            Debts that stay in your own currency and off the chain, netted with a certificate everyone in the loop
            signs.
          </p>
          <Steps steps={OBLIGATIONS} />
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <p className="text-center text-xs font-medium uppercase tracking-wide text-gold">
            Trust
          </p>
          <h2 className="mt-3 text-center font-serif-display text-3xl">
            How Contraflow is built
          </h2>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
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
