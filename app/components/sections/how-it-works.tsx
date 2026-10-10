import { Gloss } from "../marketing/Gloss";

type Frame = {
  heading: string;
  status: { label: string; cleared?: boolean };
  rows: readonly (readonly [string, string])[];
  note: string;
};

const STEPS: readonly { title: string; body: string; frame: Frame }[] = [
  {
    title: "Sign",
    body: "You and your counterparty both sign each debt: a USDC invoice on Arc, or an obligation in the currency you invoice in.",
    frame: {
      heading: "Review and sign",
      status: { label: "Awaiting you" },
      rows: [
        ["You owe", "Company B"],
        ["Amount", "1,000.00 USDC"],
      ],
      note: "One free confirmation",
    },
  },
  {
    title: "Find the loop",
    body: "Contraflow finds closed loops and shows how much would net off before anyone submits a transaction.",
    frame: {
      heading: "Ready to net",
      status: { label: "Loop found" },
      rows: [
        ["Loop", "3 invoices"],
        ["Netted from each", "1,000.00 USDC"],
      ],
      note: "No cash moves",
    },
  },
  {
    title: "Net it",
    body: "One transaction nets a loop of invoices. For obligations, one certificate everyone signs is recorded on Arc, so the same debt cannot be netted twice.",
    frame: {
      heading: "Receipt",
      status: { label: "Fully netted", cleared: true },
      rows: [
        ["Before", "1,000.00 USDC"],
        ["Remaining", "0.00 USDC"],
      ],
      note: "Open on Arc",
    },
  },
];

function StepFrame({ frame }: { frame: Frame }) {
  return (
    <figure
      className="mt-auto rounded-card border border-border-subtle bg-surface-1 p-5"
      aria-label={`Illustration: ${frame.heading}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{frame.heading}</p>
        <span
          className={
            frame.status.cleared
              ? "rounded-pill border border-cleared/50 px-2.5 py-0.5 text-[13px] text-cleared"
              : "rounded-pill border border-border-input px-2.5 py-0.5 text-[13px] text-muted"
          }
        >
          {frame.status.label}
        </span>
      </div>
      <dl className="mt-4 divide-y divide-border-subtle text-sm">
        {frame.rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-border-subtle pt-3 text-sm text-muted">{frame.note}</p>
      <figcaption className="mt-3 text-[13px] text-muted">Illustration of the app.</figcaption>
    </figure>
  );
}

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

      <ol className="mt-14 grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="relative flex flex-col">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/60 text-sm font-medium text-gold"
              >
                {index + 1}
              </span>
              <span
                aria-hidden="true"
                className={`hidden h-px flex-1 bg-border-subtle sm:block ${index === STEPS.length - 1 ? "sm:hidden" : ""}`}
              />
            </div>
            <h3 className="mt-4 text-lg font-medium">
              <span className="sr-only">Step {index + 1}: </span>
              {step.title}
            </h3>
            <p className="mb-6 mt-2 text-sm text-muted">{step.body}</p>
            <StepFrame frame={step.frame} />
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
