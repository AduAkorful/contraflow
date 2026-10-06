import { GITHUB_REPO } from "../../src/site/github";

const BUILT_ON = [
  { label: "Circle", href: "https://www.circle.com/" },
  { label: "Arc", href: "https://docs.arc.io/" },
  { label: "Privy", href: "https://www.privy.io/" },
  { label: "Sourcify", href: "https://sourcify.dev/" },
] as const;

export function ProofStrip() {
  return (
    <section className="border-y border-border-subtle bg-surface-1">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          Built on{" "}
          {BUILT_ON.map((item, index) => (
            <span key={item.label}>
              {index > 0 ? " · " : null}
              <a href={item.href} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
                {item.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </span>
          ))}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="https://sourcify.dev/" target="_blank" rel="noreferrer" className="text-foreground hover:underline">
            Contracts verified ↗
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a href={GITHUB_REPO} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
            Source on GitHub
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </div>
    </section>
  );
}
