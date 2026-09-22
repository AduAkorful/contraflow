import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

const INTEGRATIONS = [
  {
    title: "Swap Kit",
    body: "Shows a live USDC→EURC rate for anything left over after a cycle cancels. Quote-only for now — it never places a trade for you.",
    href: "https://docs.arc.io/app-kit",
  },
  {
    title: "Unified Balance / Gateway",
    body: "Moves funds across chains onto Arc when you need to top up a residual after netting.",
    href: "https://docs.arc.io/app-kit/unified-balance",
  },
  {
    title: "Developer-Controlled Wallets",
    body: "Lets us submit a transaction on your behalf, backed by Circle's wallet infrastructure — used when we sign for you rather than your own wallet.",
    href: "https://developers.circle.com/wallets/dev-controlled",
  },
  {
    title: "User-Controlled Wallets",
    body: "A sign-in method for a counterparty who doesn't already have a wallet — coming soon, not yet available in the app.",
  },
  {
    title: "Compliance Engine",
    body: "The vendor path for address screening — access is gated by Circle and not yet available to us. Today we screen against a manually maintained list instead.",
    href: "https://developers.circle.com/w3s/docs/compliance-engine",
  },
  {
    title: "Arc Explorer",
    body: "Every transaction is independently verifiable here — our receipts are never the only copy of the truth.",
  },
];

export default function IntegrationsPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
          <h1 className="font-serif-display text-5xl leading-[1.05]">Built on Circle and Arc</h1>
          <p className="mx-auto mt-6 max-w-xl text-muted">
            Real infrastructure, not a simulated backend.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {INTEGRATIONS.map((i) => (
              <div key={i.title} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
                <h3 className="font-medium">{i.title}</h3>
                <p className="mt-2 text-sm text-muted">{i.body}</p>
                {i.href ? (
                  <a href={i.href} className="mt-4 inline-block text-sm text-gold hover:underline">
                    Docs →
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
