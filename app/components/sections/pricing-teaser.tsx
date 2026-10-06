import Link from "next/link";

export function PricingTeaser() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex flex-col items-start justify-between gap-4 border-y border-border-subtle py-8 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-medium">$0 protocol fee today</h2>
          <p className="mt-1 text-sm text-muted">You only pay Arc network gas, priced in USDC.</p>
        </div>
        <Link href="/pricing" className="text-sm text-gold hover:underline">
          See typical gas costs →
        </Link>
      </div>
    </section>
  );
}
