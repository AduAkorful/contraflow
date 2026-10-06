import { Gloss } from "../marketing/Gloss";

const STEPS = [
  {
    title: "Sign",
    body: "You and your counterparty both sign each debt: a USDC invoice on Arc, or an obligation in the currency you invoice in.",
    frame: {
      heading: "Review and sign",
      lines: ["You owe Company B", "1,000.00 USDC", "One free confirmation"],
    },
  },
  {
    title: "Find the loop",
    body: "Contraflow finds closed loops and shows how much would net off before anyone submits a transaction.",
    frame: {
      heading: "Ready to net",
      lines: ["3 invoices form a loop", "1,000.00 USDC from each", "No cash moves"],
    },
  },
  {
    title: "Net it",
    body: "One transaction nets a loop of invoices. For obligations, one certificate everyone signs is recorded on Arc, so the same debt cannot be netted twice.",
    frame: {
      heading: "Receipt",
      lines: ["Before 1,000.00 → remaining 0.00", "Fully netted", "Open on Arc ↗"],
    },
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-28 mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-serif-display text-4xl">How it works</h2>
        <p className="mt-4 text-muted">
          From two signatures to a loop netted out, in three steps. Screens are labelled illustrations
          of the app, not a live session.
        </p>
      </div>

      <ol className="mt-12 grid gap-8 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <p className="text-sm font-medium text-gold">{index + 1}</p>
            <h3 className="mt-2 text-lg font-medium">{step.title}</h3>
            <p className="mt-2 text-sm text-muted">{step.body}</p>
            <figure className="mt-5 rounded-card border border-border-subtle bg-surface-1 p-4">
              <p className="text-sm font-semibold">{step.frame.heading}</p>
              <ul className="mt-3 space-y-1.5 text-sm text-muted">
                {step.frame.lines.map((line) => (
                  <li key={line} className={line === "Fully netted" ? "text-cleared" : undefined}>
                    {line}
                  </li>
                ))}
              </ul>
              <figcaption className="mt-3 text-[13px] text-muted">Illustration of the app.</figcaption>
            </figure>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-center text-sm text-muted">
        A{" "}
        <Gloss title="The file every party in an obligation loop signs. Check it in your browser against the ledger.">
          certificate
        </Gloss>{" "}
        is not a{" "}
        <Gloss title="The onchain record of an invoice loop that was netted.">receipt</Gloss>. You
        keep the certificate; anyone can open the receipt.
      </p>
    </section>
  );
}
