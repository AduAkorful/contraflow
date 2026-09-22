import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

const SECTIONS = [
  {
    title: "What we collect",
    body: "When you connect a wallet, we read your wallet address — and, if you sign in with Circle User-Controlled Wallets, the email tied to that login — to show you your own invoice history. That's the extent of it.",
  },
  {
    title: "On-chain data is public",
    body: "Invoices are recorded on Arc, a public blockchain. Once an invoice is registered, anyone can see the debtor and creditor addresses, the amount, and the terms. Don't include anything in an invoice you wouldn't want a counterparty, a competitor, or a stranger to see.",
  },
  {
    title: "What we don't do",
    body: "We don't sell your data, and we don't run third-party ad trackers or analytics resale.",
  },
  {
    title: "Questions",
    body: "Our source code is public. If something here is unclear, open an issue on our GitHub repo, linked from the Contact page.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-3xl px-6 pb-8 pt-10">
          <h1 className="font-serif-display text-5xl leading-[1.05]">Privacy</h1>
          <p className="mt-6 text-muted">
            Short and plain-language, not a substitute for legal advice.
          </p>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-8">
          <div className="space-y-10">
            {SECTIONS.map((s) => (
              <div key={s.title}>
                <h2 className="text-lg font-medium text-gold">{s.title}</h2>
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
