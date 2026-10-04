import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

export const metadata = { title: "Integrations" };


type Integration = { title: string; body: string; href?: string };

const IN_THE_APP: Integration[] = [
  {
    title: "Arc",
    body: "Invoices, settlements and netting certificates are all recorded on Arc, with gas paid in native USDC.",
    href: "https://docs.arc.io/",
  },
  {
    title: "Arc Explorer",
    body: "Every transaction can be checked independently here, and the protocol stats are counted from the contracts' events on it.",
  },
  {
    title: "Privy",
    body: "Sign in with the wallet you already use, or with your email.",
    href: "https://docs.privy.io/",
  },
  {
    title: "Sourcify",
    body: "The source of every Contraflow contract is published and verified against the deployed bytecode.",
    href: "https://sourcify.dev/",
  },
];

const IN_THE_PIPELINE: Integration[] = [
  {
    title: "Swap Kit",
    body: "Can get a live USDC to EURC quote for any balance a loop leaves behind. Quotes only: it never places a trade.",
    href: "https://docs.arc.io/app-kit",
  },
  {
    title: "Unified Balance / Gateway",
    body: "Can fund a remaining balance on Arc from USDC held on another chain.",
    href: "https://docs.arc.io/app-kit/unified-balance",
  },
  {
    title: "Developer-Controlled Wallets",
    body: "Lets Contraflow's own operator wallet sign its transactions through Circle's wallet infrastructure.",
    href: "https://developers.circle.com/wallets/dev-controlled",
  },
];

function Cards({ items }: { items: Integration[] }) {
  return (
    <div className={`mt-10 grid gap-6 sm:grid-cols-2 ${items.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      {items.map((i) => (
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
  );
}

export default function IntegrationsPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
          <h1 className="font-serif-display text-5xl leading-[1.05]">Built on Circle and Arc</h1>
          <p className="mx-auto mt-6 max-w-xl text-muted">
            Contraflow runs on Arc and Circle&apos;s infrastructure.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="font-serif-display text-3xl">In the app</h2>
          <Cards items={IN_THE_APP} />
        </section>

        <section className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="font-serif-display text-3xl">In the settlement pipeline</h2>
          <p className="mt-4 max-w-2xl text-sm text-muted">
            Contraflow&apos;s settlement pipeline runs server-side after a loop is netted, and uses Circle&apos;s App Kit
            and wallet infrastructure.
          </p>
          <Cards items={IN_THE_PIPELINE} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
