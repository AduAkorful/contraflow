import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-gradient-to-b from-gold/15 via-gold/0 to-transparent"
      />

      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pb-20 pt-16 text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-pill border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold">
          ★ BUILT ON ARC
        </span>

        <h1 className="font-serif-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Cancel circular debt in one transaction
        </h1>

        <p className="mt-6 max-w-xl text-balance text-base text-muted sm:text-lg">
          Contraflow finds closed cycles among bilaterally-attested invoices and cancels the whole
          cycle in one on-chain call — no USDC moves except gas.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/app"
            className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
          >
            Launch App
          </Link>
          <Link
            href="/features"
            className="rounded-pill border border-white/15 px-6 py-3 text-sm font-medium transition-colors hover:border-white/30"
          >
            Explore Features
          </Link>
        </div>

        <p className="mt-16 text-xs uppercase tracking-wide text-muted">
          $0 protocol fee · gas priced in USDC · permissionless settlement
        </p>
      </div>
    </section>
  );
}
