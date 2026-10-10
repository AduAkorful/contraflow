"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useSignIn } from "./signInContext";

type View = "home" | "email" | "code";

const inputClass =
  "w-full rounded-xl border border-border-input bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted focus:border-gold";
const primaryClass =
  "w-full rounded-pill bg-gold px-4 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.01] disabled:state-disabled disabled:scale-100";

function Icon({ d, className = "size-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const MAIL = "M4 6h16v12H4zM4 7l8 6 8-6";
const WALLET = "M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2zM16 14h2";
const CHEVRON = "M9 6l6 6-6 6";
const CLOSE = "M6 6l12 12M18 6L6 18";

/// Top-right sign-in control. The button opens a centred dialog (like most wallet apps): email on
/// top, then a wallet. A click on the backdrop, the close button or Escape closes it. Email stays in
/// the dialog; a wallet opens the short wallet list.
export function SignInMenu({ initialOpen = false }: { initialOpen?: boolean }) {
  const { menuOpen, openMenu, closeMenu, phase, error, sendEmailCode, submitEmailCode, startWallet, sessionAddress } =
    useSignIn();
  const [view, setView] = useState<View>("home");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [switching, setSwitching] = useState(false);
  const titleId = useId();
  const opened = useRef(false);

  useEffect(() => {
    if (!initialOpen || opened.current) return;
    opened.current = true;
    openMenu();
  }, [initialOpen, openMenu]);

  useEffect(() => {
    if (!menuOpen) {
      setView("home");
      setLocalError(null);
      setBusy(false);
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      trigger?.focus();
    };
  }, [menuOpen, closeMenu]);

  useEffect(() => {
    setMounted(true);
    // Arrived from "Switch account": say so, and drop the marker so a refresh doesn't reopen it.
    const params = new URLSearchParams(window.location.search);
    if (params.get("switch") === "1") {
      setSwitching(true);
      params.delete("switch");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  if (sessionAddress) return null;

  const shownError = localError ?? error;
  const waiting = busy || phase === "connecting" || phase === "signing";

  async function onSendEmail(event: FormEvent) {
    event.preventDefault();
    const next = email.trim();
    if (!next.includes("@")) {
      setLocalError("Enter an email address.");
      return;
    }
    setBusy(true);
    setLocalError(null);
    const message = await sendEmailCode(next);
    setBusy(false);
    if (message) setLocalError(message);
    else setView("code");
  }

  async function onSubmitCode(event: FormEvent) {
    event.preventDefault();
    const next = code.trim();
    if (!next) {
      setLocalError("Enter the code from the email.");
      return;
    }
    setBusy(true);
    setLocalError(null);
    const message = await submitEmailCode(next);
    setBusy(false);
    if (message) setLocalError(message);
  }

  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeMenu();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[26rem] rounded-card border border-border-subtle bg-surface-1 p-6 shadow-2xl sm:p-8"
      >
        <button
          type="button"
          onClick={closeMenu}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <Icon d={CLOSE} className="size-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <Image src="/logo-mark.png" alt="" width={44} height={44} className="size-11" />
          <h2 id={titleId} className="mt-4 text-xl font-medium">
            {view === "code" ? "Check your email" : switching ? "Sign in with another account" : "Sign in to Contraflow"}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {view === "code"
              ? `We sent a code to ${email}.`
              : "Use your email or a wallet. Signing in sends nothing onchain."}
          </p>
        </div>

        {view === "code" ? (
          <form className="mt-6 grid gap-3" onSubmit={onSubmitCode}>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="······"
              aria-label="Code from the email"
              className={`${inputClass} text-center text-xl tracking-[0.4em]`}
            />
            <button type="submit" disabled={waiting} className={primaryClass}>
              {waiting ? "Checking…" : "Continue"}
            </button>
            <div className="flex items-center justify-between text-xs text-muted">
              <button type="button" className="hover:text-foreground" onClick={() => { setCode(""); setLocalError(null); setView("home"); }}>
                Use a different email
              </button>
              <button
                type="button"
                className="hover:text-foreground disabled:state-disabled"
                disabled={waiting}
                onClick={async () => {
                  setBusy(true);
                  setLocalError(null);
                  const message = await sendEmailCode(email.trim());
                  setBusy(false);
                  if (message) setLocalError(message);
                }}
              >
                Resend code
              </button>
            </div>
          </form>
        ) : (
          <>
            <form className="mt-6 grid gap-3" onSubmit={onSendEmail}>
              <label className="relative block">
                <span className="sr-only">Email address</span>
                <Icon d={MAIL} className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className={`${inputClass} pl-12`}
                />
              </label>
              <button type="submit" disabled={waiting} className={primaryClass}>
                {waiting ? "Sending the code…" : "Continue with email"}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-muted" aria-hidden="true">
              <span className="h-px flex-1 bg-border-subtle" />
              or
              <span className="h-px flex-1 bg-border-subtle" />
            </div>

            <button
              type="button"
              onClick={startWallet}
              className="group flex w-full items-center gap-3 rounded-xl border border-border-input px-4 py-3 text-left hover:border-white/40 hover:bg-surface-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-gold">
                <Icon d={WALLET} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Continue with a wallet</span>
                <span className="block truncate text-xs text-muted">MetaMask, Coinbase, Rainbow and more</span>
              </span>
              <Icon d={CHEVRON} className="size-4 text-muted group-hover:text-foreground" />
            </button>
          </>
        )}

        {shownError && (
          <p role="alert" className="mt-3 text-center text-sm text-danger">
            {shownError}
          </p>
        )}

        <p className="mt-6 text-center text-xs text-muted">
          By continuing you agree to the{" "}
          <Link href="/terms" className="underline hover:text-foreground" onClick={closeMenu}>Terms</Link> and{" "}
          <Link href="/privacy" className="underline hover:text-foreground" onClick={closeMenu}>Privacy Policy</Link>.
          Sign-in by <span className="text-foreground">Privy</span>.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (menuOpen ? closeMenu() : openMenu())}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        className="inline-flex h-8 items-center rounded-pill bg-gold px-3 text-sm font-medium text-black hover:scale-[1.02]"
      >
        Sign in
      </button>
      {menuOpen && mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
