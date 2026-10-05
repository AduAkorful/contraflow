/// Shared frame for the two composers: progress across the top, the form on the left and a
/// "What happens next" panel beside it (below it on a narrow screen).

const STEPS = ["Details", "Review and sign", "Share link"] as const;

export function Stepper({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol aria-label="Progress" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {STEPS.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <li key={step} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`flex size-5 items-center justify-center rounded-full text-xs font-medium ${
                  state === "current"
                    ? "bg-gold text-black"
                    : state === "done"
                      ? "bg-success/20 text-success"
                      : "border border-border-input text-faint"
                }`}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              <span className={state === "current" ? "font-medium text-foreground" : "text-muted"}>
                {step}
                {state === "done" && <span className="sr-only"> (done)</span>}
              </span>
            </span>
            {index < STEPS.length - 1 && <span aria-hidden className="h-px w-6 bg-border-subtle" />}
          </li>
        );
      })}
    </ol>
  );
}

export function WhatHappensNext({ items }: { items: readonly { title: string; body: string }[] }) {
  return (
    <aside aria-label="What happens next" className="rounded-card border border-border-subtle bg-surface-1 p-5">
      <h2 className="text-sm font-semibold">What happens next</h2>
      <ol className="mt-4 space-y-4">
        {items.map((item, index) => (
          <li key={item.title} className="flex gap-3 text-sm">
            <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border-input text-xs text-muted">
              {index + 1}
            </span>
            <div>
              <p className="font-medium text-foreground">{item.title}</p>
              <p className="mt-0.5 text-muted">{item.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function ComposerFrame({
  step,
  next,
  children,
}: {
  step: 0 | 1 | 2;
  next: readonly { title: string; body: string }[];
  children: React.ReactNode;
}) {
  return (
    <div>
      <Stepper current={step} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="min-w-0">{children}</div>
        <WhatHappensNext items={next} />
      </div>
    </div>
  );
}
