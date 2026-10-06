import Link from "next/link";

export function Cta() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-16 text-center">
      <div className="rounded-card border border-border-subtle bg-surface-1 px-8 py-16">
        <h2 className="font-serif-display text-4xl">Start netting</h2>
        <p className="mx-auto mt-4 max-w-md text-muted">
          Record a debt with a counterparty, find the loop and net it. No cash moves except gas.
        </p>
        <Link
          href="/app"
          className="mt-8 inline-block rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
        >
          Start free
        </Link>
      </div>
    </section>
  );
}
