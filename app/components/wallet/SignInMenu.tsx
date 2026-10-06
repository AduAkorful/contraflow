"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useSignIn } from "./signInContext";

type View = "home" | "email" | "code";

const rowClass =
  "flex w-full items-center rounded-lg border border-border-input px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface-2";

/// Top-right sign-in control. The panel drops open under the button. A click anywhere else, or
/// Escape, closes it. Email stays in the panel. A wallet opens the short wallet list.
export function SignInMenu({ initialOpen = false }: { initialOpen?: boolean }) {
  const { menuOpen, openMenu, closeMenu, phase, error, sendEmailCode, submitEmailCode, startWallet, sessionAddress } =
    useSignIn();
  const [view, setView] = useState<View>("home");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpen, closeMenu]);

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => (menuOpen ? closeMenu() : openMenu())}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        className="inline-flex h-8 items-center rounded-pill bg-gold px-3 text-sm font-medium text-black hover:scale-[1.02]"
      >
        Sign in
      </button>
      {menuOpen && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-border-subtle bg-surface-1 p-4 text-left shadow-lg"
        >
          <p id={titleId} className="text-center text-sm font-medium">
            {view === "code" ? "Enter the code" : view === "email" ? "Continue with email" : "Sign in"}
          </p>
          {view === "home" && (
            <div className="mt-3 grid gap-2">
              <button type="button" className={rowClass} onClick={() => setView("email")}>
                Continue with email
              </button>
              <button type="button" className={rowClass} onClick={startWallet}>
                Use a crypto wallet
              </button>
              <p className="px-1 text-center text-xs text-muted">Nothing is sent onchain.</p>
            </div>
          )}
          {view === "email" && (
            <form className="mt-3 grid gap-2" onSubmit={onSendEmail}>
              <input
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@email.com"
                className="rounded-lg border border-border-input bg-bg px-3 py-2.5 text-sm"
              />
              <button type="submit" disabled={waiting} className="rounded-pill bg-gold px-3 py-2.5 text-sm font-medium text-black disabled:state-disabled">
                {waiting ? "Sending the code…" : "Send code"}
              </button>
              <button type="button" className="text-xs text-muted hover:text-foreground" onClick={() => setView("home")}>
                Back
              </button>
            </form>
          )}
          {view === "code" && (
            <form className="mt-3 grid gap-2" onSubmit={onSubmitCode}>
              <p className="text-center text-xs text-muted">We sent a code to {email}.</p>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Code"
                className="rounded-lg border border-border-input bg-bg px-3 py-2.5 text-center text-sm tracking-widest"
              />
              <button type="submit" disabled={waiting} className="rounded-pill bg-gold px-3 py-2.5 text-sm font-medium text-black disabled:state-disabled">
                {waiting ? "Checking…" : "Continue"}
              </button>
              <button type="button" className="text-xs text-muted hover:text-foreground" onClick={() => setView("email")}>
                Use a different email
              </button>
            </form>
          )}
          {shownError && (
            <p role="alert" className="mt-2 text-center text-xs text-danger">
              {shownError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
