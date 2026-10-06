import Link from "next/link";
import { MarketingPage } from "../../components/marketing/MarketingPage";

export const metadata = { title: "Features" };

const INVOICES = [
  {
    title: "Sign",
    body: "The debtor and creditor each sign the invoice with their own wallet. It's registered on Arc once both signatures are in.",
  },
  {
    title: "Find the loop",
    body: "See exactly which invoices form a closed loop and how much would net off, before you commit to anything.",
  },
  {
    title: "Net it",
    body: "One transaction nets the same amount off every invoice in the loop, with a link to it on the Arc explorer.",
  },
  {
    title: "Get a receipt",
    body: "See the block, the transaction and exactly what changed for every invoice involved.",
  },
];

const OBLIGATIONS = [
  {
    title: "Record it in any currency",
    body: "Record what you owe or are owed in the currency you actually invoice in. Obligation amounts never go onchain. Contraflow's servers can read them. Invoice amounts and parties are public on Arc.",
  },
  {
    title: "Both sides sign",
    body: "Send a short link. Each obligation's terms are shown only to its two parties, after they sign in. Their browser checks your signature before they sign.",
  },
  {
    title: "One certificate per loop",
    body: "When obligations form a loop, everyone in it reviews their own obligations and signs one netting certificate.",
  },
  {
    title: "Never netted twice",
    body: "Applying the certificate records a blinded state for each obligation on Arc. The same debt can't be netted again from an old state.",
  },
  {
    title: "Keep your certificate",
    body: "Download your copy of the certificate. It holds your own obligations in full, and no one else's amounts.",
  },
  {
    title: "Verify any certificate",
    body: "Check a certificate against the ledger on Arc, in your browser, without uploading it.",
    href: "/app/verify",
  },
];

type Step = { title: string; body: string; href?: string };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <div className={`mt-12 grid gap-6 sm:grid-cols-2 ${steps.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      {steps.map((step, index) => (
        <div key={step.title} className="rounded-card border border-border-subtle bg-surface-1 p-6">
          <span className="text-sm font-medium text-gold">{index + 1}</span>
          <h3 className="mt-2 font-medium">{step.title}</h3>
          <p className="mt-2 text-sm text-muted">{step.body}</p>
          {step.href ? (
            <Link href={step.href} className="mt-3 inline-block text-sm text-gold hover:underline">
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
    <MarketingPage>
      <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
        <h1 className="font-serif-display text-5xl leading-[1.05]">Net what you owe and are owed</h1>
        <p className="mx-auto mt-6 max-w-xl text-muted">
          Two ways to net out a loop of debt: USDC invoices on Arc, and obligations in any currency.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center font-serif-display text-3xl">Invoices on Arc</h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-muted">
          USDC invoices, registered on Arc and netted in place, with no USDC moving except gas.
        </p>
        <Steps steps={INVOICES} />
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center font-serif-display text-3xl">Obligations in any currency</h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-muted">
          Debts that stay in your own currency and off the chain, netted with a certificate everyone
          in the loop signs.
        </p>
        <Steps steps={OBLIGATIONS} />
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-20 text-center">
        <Link href="/app" className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black">
          Start free
        </Link>
      </section>
    </MarketingPage>
  );
}
