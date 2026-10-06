/// Dimmed Overview stand-in for the signed-out `/app` page. Figures are round and made up, like
/// the home hero, and the caption says so.

export const OVERVIEW_ILLUSTRATION_CAPTION = "Example: an illustration, not a real transaction.";

const SECTIONS = [
  { title: "Your position", body: "You owe 1,000.00 USDC · You're owed 1,000.00 USDC · Net 0.00 USDC" },
  { title: "Ready to net", body: "3 invoices form a loop: 1,000.00 USDC netted from each. No cash moves." },
  { title: "Waiting on you", body: "Company B · 1,000.00 USDC · Review and sign" },
  { title: "Recent activity", body: "Invoice registered · 1,000.00 USDC" },
] as const;

export function OverviewIllustration() {
  return (
    <figure className="pointer-events-none select-none">
      <div className="mx-auto max-w-4xl px-4 py-10 opacity-40 sm:px-6">
        <p className="text-3xl font-semibold">Overview</p>
        <div className="mt-8 grid gap-4">
          {SECTIONS.map((section) => (
            <section key={section.title} className="rounded-card border border-border-subtle bg-surface-1 px-5 py-4">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              <p className="mt-2 text-sm text-muted">{section.body}</p>
            </section>
          ))}
        </div>
      </div>
      <figcaption className="px-4 pb-6 text-center text-xs text-faint">{OVERVIEW_ILLUSTRATION_CAPTION}</figcaption>
    </figure>
  );
}
