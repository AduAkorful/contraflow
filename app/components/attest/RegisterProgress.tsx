import type { ReactNode } from "react";

/// Three-step register progress. The transaction link appears as soon as the wallet returns a hash.

export function RegisterProgress({
  step,
  txHash,
  explorerBase,
}: {
  step: 1 | 2 | 3;
  txHash?: string | null;
  explorerBase?: string;
}) {
  const tx =
    txHash && explorerBase ? (
      <a href={`${explorerBase}/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-gold hover:underline">
        tx ↗
      </a>
    ) : null;
  const items: { n: 1 | 2 | 3; label: ReactNode }[] = [
    { n: 1, label: "Sign" },
    { n: 2, label: tx ? <>Submitted {tx}</> : "Submitted" },
    { n: 3, label: "Confirmed" },
  ];
  return (
    <ol className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
      {items.map((item, i) => (
        <li key={item.n} className={item.n <= step ? "text-foreground" : ""}>
          {i > 0 ? <span className="mr-3 text-faint">·</span> : null}
          {item.n} {item.label}
        </li>
      ))}
    </ol>
  );
}
