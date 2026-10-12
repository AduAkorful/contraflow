import { useId } from "react";

export const inputClass =
  "w-full rounded-lg border border-border-input bg-surface-1 px-4 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-focus";

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

/// A form control with its label above it in sentence case, and optional help text tied to the
/// control for screen readers. The control is passed as a render function so it gets the ids.
export function Field({
  label,
  hint,
  error,
  note,
  children,
}: {
  label: string;
  hint?: string;
  /// A problem with this field's value, shown under it and announced with the control.
  error?: string | null;
  /// Extra, non-blocking information about the value (never styled as an error).
  note?: string | null;
  children: (props: ControlProps) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;
  const describedBy = [error ? errorId : null, note ? noteId : null, hint ? hintId : null].filter(Boolean).join(" ");
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="mt-1.5">{children({ id, ...(describedBy ? { "aria-describedby": describedBy } : {}), ...(error ? { "aria-invalid": true as const } : {}) })}</div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
      {note && !error && (
        <p id={noteId} className="mt-1.5 text-xs text-muted">
          {note}
        </p>
      )}
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
