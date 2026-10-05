import { useId } from "react";

export const inputClass =
  "w-full rounded-lg border border-border-input bg-surface-1 px-4 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-focus";

type ControlProps = { id: string; "aria-describedby"?: string };

/// A form control with its label above it in sentence case, and optional help text tied to the
/// control for screen readers. The control is passed as a render function so it gets the ids.
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (props: ControlProps) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="mt-1.5">{children({ id, ...(hint ? { "aria-describedby": hintId } : {}) })}</div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/// An input with a fixed unit shown inside its right edge (USDC), so the unit is never ambiguous.
export function SuffixInput({ suffix, ...props }: { suffix: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <input {...props} className={`${inputClass} pr-16 ${props.className ?? ""}`} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-medium text-faint">
        {suffix}
      </span>
    </div>
  );
}
