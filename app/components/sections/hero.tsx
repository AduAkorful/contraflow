import Link from "next/link";
import { HeroExample } from "./hero-example";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-gradient-to-b from-gold/15 via-gold/0 to-transparent"
      />

      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pb-20 pt-12 text-center">
        <p className="mb-6 text-sm font-medium text-gold">Netting, not credit.</p>

        <h1 className="font-serif-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Cancel circular debt in one transaction
        </h1>

        <p className="mt-6 max-w-xl text-balance text-base text-muted sm:text-lg">
          When A owes B, B owes C and C owes A, Contraflow nets the loop in one signed step. No cash
          moves.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/app"
            className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
          >
            Start free
          </Link>
          <Link href="/#how-it-works" className="text-sm font-medium text-foreground hover:underline">
            How it works
          </Link>
        </div>

        <HeroExample />
      </div>
    </section>
  );
}
