import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

const CONTACT_CARDS = [
  {
    title: "Code & issues",
    body: "Bug reports, feature questions, or anything about how the contracts or app work.",
    link: "https://github.com/AduAkorful/contraflow",
    cta: "Open the repo",
  },
  {
    title: "Verify it yourself",
    body: "Every claim on this site is checkable — contract addresses, transaction hashes, and the source are all public.",
    link: "https://github.com/AduAkorful/contraflow",
    cta: "See the source",
  },
];

export default function ContactPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
          <h1 className="font-serif-display text-5xl leading-[1.05]">Connect With Us</h1>
          <p className="mx-auto mt-6 max-w-xl text-muted">
            Contraflow is an open-repo project. The public GitHub repo is the real channel — no
            support desk, no sales line.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid gap-6 sm:grid-cols-2">
            {CONTACT_CARDS.map((c) => (
              <div key={c.title} className="rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
                <h3 className="font-medium">{c.title}</h3>
                <p className="mt-2 text-sm text-muted">{c.body}</p>
                <a
                  href={c.link}
                  className="mt-4 inline-block rounded-pill border border-white/15 px-5 py-2 text-sm hover:border-white/30"
                >
                  {c.cta}
                </a>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
