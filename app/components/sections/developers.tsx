import Link from "next/link";
import { docsNavLink } from "../../src/site/docsUrl";

export function Developers() {
  const docs = docsNavLink();

  return (
    <section id="developers" className="mx-auto max-w-6xl px-6 py-20">
      <div className="rounded-card border border-border-subtle bg-surface-1 px-6 py-10 sm:px-10">
        <h2 className="font-serif-display text-4xl">For developers</h2>
        <p className="mt-4 max-w-2xl text-muted">
          Offchain obligations can be recorded through the API. Parties grant scoped, expiring
          permissions. Tenants submit the signatures those parties made. Contraflow never signs
          for you, and never holds keys.
        </p>
        <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {docs.external ? (
            <a href={docs.href} target="_blank" rel="noreferrer" className="text-gold hover:underline">
              Read the docs ↗
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <Link href={docs.href} className="text-gold hover:underline">
              Read the docs
            </Link>
          )}
          <Link href="/integrations" className="text-gold hover:underline">
            Integrations &amp; API
          </Link>
          <Link href="/contact" className="text-gold hover:underline">
            Request an API key
          </Link>
        </p>
      </div>
    </section>
  );
}
