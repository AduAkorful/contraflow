"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/// Building blocks for the balance page's swap-style card: a "from" box with a large amount and a
/// chain selector, a "to" box, and a full-width action button.

export function AmountBox({
  label,
  value,
  onChange,
  disabled,
  readOnly,
  selector,
  balance,
  onMax,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  selector: ReactNode;
  balance?: ReactNode;
  onMax?: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-border-subtle bg-surface-2/70 p-5 focus-within:border-white/25">
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <input
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          inputMode="decimal"
          placeholder="0"
          disabled={disabled}
          readOnly={readOnly}
          aria-label={`${label} amount in USDC`}
          className="min-w-0 flex-1 bg-transparent text-4xl font-medium tabular-nums text-foreground placeholder:text-muted/50 focus:outline-none"
        />
        {selector}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
        <span className="tabular-nums">{balance}</span>
        {onMax && (
          <button
            type="button"
            onClick={onMax}
            disabled={disabled}
            className="rounded-pill border border-border-input px-2.5 py-0.5 text-gold hover:border-gold/60 disabled:state-disabled"
          >
            Max
          </button>
        )}
      </div>
    </div>
  );
}

/// Real network and token logos live in `public/chains/` (MIT-licensed web3icons set), so no
/// third-party request is made. Names that have no file fall back to an initial.
const CHAIN_LOGOS: [prefix: string, file: string][] = [
  ["ethereum", "ethereum"],
  ["base", "base"],
  ["arbitrum", "arbitrum"],
  ["optimism", "optimism"],
  ["op ", "optimism"],
  ["avalanche", "avalanche"],
  ["polygon", "polygon"],
  ["unichain", "unichain"],
  ["world", "world"],
  ["sonic", "sonic"],
  ["sei", "sei"],
  ["hyperevm", "hyperevm"],
  ["usdc", "usdc"],
];

export function chainLogo(name: string): string | null {
  const lower = name.trim().toLowerCase();
  const hit = CHAIN_LOGOS.find(([prefix]) => lower.startsWith(prefix));
  return hit ? `/chains/${hit[1]}.svg` : null;
}

/// A round badge for a chain or venue: its logo, the Contraflow mark for Arc and Gateway, or an
/// initial when there is no logo.
export function ChainBadge({ name, mark = false }: { name: string; mark?: boolean }) {
  const logo = mark ? null : chainLogo(name);
  if (mark) return <Image src="/logo-mark.png" alt="" width={24} height={24} className="size-6 shrink-0" />;
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} alt="" width={24} height={24} className="size-6 shrink-0 rounded-full ring-1 ring-white/10" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-1 text-[13px] font-medium text-muted ring-1 ring-border-input"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function ChainPill({ children, mark = false, name }: { children: ReactNode; mark?: boolean; name: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-pill border border-border-input bg-surface-1 py-1.5 pl-2 pr-4 text-sm font-medium">
      <ChainBadge name={name} mark={mark} />
      {children}
    </span>
  );
}

/// A pill that opens a dark listbox of chains (the browser's own select popup can't be themed).
/// Arrow keys move, Enter or Space picks, Escape and an outside click close.
export function ChainSelect({
  value,
  onChange,
  options,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function openList() {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "Escape") setOpen(false);
    else if (event.key === "ArrowDown") setActive((i) => Math.min(options.length - 1, i + 1));
    else if (event.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (event.key === "Enter" || event.key === " ") pick(active);
    else return;
    event.preventDefault();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="inline-flex items-center gap-2 rounded-pill border border-border-input bg-surface-1 py-1.5 pl-2 pr-3 text-sm font-medium hover:border-white/40 focus-visible:border-gold disabled:state-disabled"
      >
        <ChainBadge name={current?.label ?? ""} />
        <span className="max-w-[10rem] truncate">{current?.label ?? "Select"}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`size-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute right-0 top-[calc(100%+8px)] z-30 max-h-72 w-64 overflow-y-auto rounded-[20px] border border-border-subtle bg-surface-1 p-1.5 shadow-2xl"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(index);
              }}
              className={`flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-sm ${
                index === active ? "bg-surface-2" : ""
              }`}
            >
              <ChainBadge name={option.label} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-gold" aria-hidden="true">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ArrowDivider() {
  return (
    <div className="relative z-10 -my-3.5 flex justify-center" aria-hidden="true">
      <span className="flex size-10 items-center justify-center rounded-xl border border-border-subtle bg-surface-2 text-muted ring-4 ring-surface-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </span>
    </div>
  );
}

export function ReceiveBox({ label, amount, target, note }: { label: string; amount: string; target: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-[20px] border border-border-subtle bg-surface-2/40 p-5">
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <p className={`min-w-0 flex-1 truncate text-4xl font-medium tabular-nums ${amount ? "text-foreground" : "text-muted/50"}`}>
          {amount || "0"}
        </p>
        {target}
      </div>
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "quiet";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        variant === "primary"
          ? "mt-4 w-full rounded-[20px] bg-gold py-4 text-base font-medium text-black transition-transform hover:scale-[1.01] disabled:state-disabled disabled:scale-100"
          : "mt-4 w-full rounded-2xl border border-border-input py-3.5 text-base hover:border-white/30 disabled:state-disabled"
      }
    >
      {children}
    </button>
  );
}

