import Link from "next/link";
import { MarketingPage } from "@/components/marketing/MarketingPage";
import { GITHUB_REPO } from "@/src/site/github";
import { pageMeta } from "@/src/site/pageMeta";

export const metadata = pageMeta(
  "/contact",
  "Contact",
  "Report a bug on GitHub. Create a test API key in the app after you sign in.",
);

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
    body: "Platforms such as ERPs, accounting apps and marketplaces can record obligations and apply certificates for their customers. Sign in and create a test key. It is shown once.",
    href: "/app/api-keys",
    cta: "Create an API key",
    external: false,
  },
] as const;

export default function ContactPage() {
  return (
    <MarketingPage>
      <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
        <h1 className="font-serif-display text-5xl leading-[1.05]">Talk to us</h1>
        <p className="mx-auto mt-6 max-w-xl text-muted">
          Bug reports go through GitHub. API keys are created in the app after you sign in.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-12">
        <div className="grid gap-6 sm:grid-cols-2">
          {CONTACT_CARDS.map((card) => (
            <div key={card.title} className="rounded-card border border-border-subtle bg-surface-1 p-6">
              <h2 className="text-lg font-medium">{card.title}</h2>
              <p className="mt-2 text-sm text-muted">{card.body}</p>
              {card.external ? (
                <a
                  href={card.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-block text-sm text-gold hover:underline"
                >
                  {card.cta}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <Link href={card.href} className="mt-4 inline-block text-sm text-gold hover:underline">
                  {card.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>
    </MarketingPage>
  );
}
