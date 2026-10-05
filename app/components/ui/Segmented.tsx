"use client";

import { useId, useRef } from "react";

/// A single-choice control as one joined strip (a radio group), with arrow-key movement. Use it for
/// two to four short options where seeing all of them at once helps the choice.
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();

  function move(from: number, step: number) {
    const next = (from + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <p className="text-sm font-medium text-foreground" id={labelId}>
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="mt-1.5 inline-flex w-full rounded-lg border border-border-input bg-surface-1 p-0.5">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  move(index, -1);
                }
              }}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
                selected ? "bg-surface-2 text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
