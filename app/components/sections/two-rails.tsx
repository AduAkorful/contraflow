import Link from "next/link";
import { Gloss } from "../marketing/Gloss";

const RAILS = [
  {
    title: "Invoices on Arc",
    body: "USDC debts both parties sign and register on Arc. When they form a loop, one transaction nets the same amount off every invoice. Amounts and parties are public on Arc.",
  },
  {
    title: "Obligations in any currency",
    body: "Debts in the currency you actually invoice in. Both parties sign; amounts never go onchain. Contraflow's servers can read them. A loop nets with one certificate everyone in it signs.",
  },
] as const;

export function TwoRails() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-serif-display text-4xl">Two ways to net a loop</h2>
        <p className="mt-4 text-muted">
          Same idea, two records: an{" "}
          <Gloss title="A USDC debt both parties sign and register on Arc.">invoice</Gloss> on{" "}
          <Gloss title="Circle's payment chain. Gas is paid in USDC.">Arc</Gloss>, or an obligation
          kept offchain.
        </p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {RAILS.map((rail) => (
          <div key={rail.title} className="rounded-card border border-border-subtle bg-surface-1 p-6">
            <h3 className="text-lg font-medium">{rail.title}</h3>
            <p className="mt-2 text-sm text-muted">{rail.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-sm">
        <Link href="/features" className="text-gold hover:underline">
          See each step →
        </Link>
      </p>
    </section>
  );
}
