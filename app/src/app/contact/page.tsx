import { MarketingPage } from "../../components/marketing/MarketingPage";
import { GITHUB_REPO } from "../../src/site/github";

export const metadata = { title: "Contact" };

const CONTACT_CARDS = [
  {
    title: "Code and issues",
    body: "Bug reports, feature questions, or anything about how the contracts or app work.",
    href: GITHUB_REPO,
    cta: "Open the repo ↗",
    external: true,
  },
  {
    title: "API access",
    body: "Platforms such as ERPs, accounting apps and marketplaces can record obligations and apply certificates for their customers. Keys are issued by hand. Ask for one in the repository and say which platform you build.",
    href: GITHUB_REPO,
    cta: "Request an API key ↗",
    external: true,
  },
] as const;

export default function ContactPage() {
  return (
    <MarketingPage>
      <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
        <h1 className="font-serif-display text-5xl leading-[1.05]">Talk to us</h1>
        <p className="mx-auto mt-6 max-w-xl text-muted">
          Questions, bug reports and partnership enquiries all go through our GitHub repository.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-12">
        <div className="grid gap-6 sm:grid-cols-2">
          {CONTACT_CARDS.map((card) => (
            <div key={card.title} className="rounded-card border border-border-subtle bg-surface-1 p-6">
              <h2 className="text-lg font-medium">{card.title}</h2>
              <p className="mt-2 text-sm text-muted">{card.body}</p>
              <a
                href={card.href}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-sm text-gold hover:underline"
              >
                {card.cta}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          ))}
        </div>
      </section>
    </MarketingPage>
  );
}
