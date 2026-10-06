"use client";

import { useSignIn } from "./useSignIn";
import { formatAddress } from "../../src/format/address";

/// Thin view over `useSignIn`. Used on `/app` and on share-link pages that already sit in the
/// wallet provider tree. Sign-in completion is observed through `useSignIn().sessionAddress` /
/// `useSession()`, never a render-time callback (that would retrigger on every signed-in mount).

export function ConnectButton({
  variant = "primary",
  layout = "single",
}: {
  variant?: "primary" | "text";
  layout?: "single" | "split";
} = {}) {
  const { phase, error, identity, sessionAddress, hint, signingLabel, start } = useSignIn();

  if (phase === "signed-in" && sessionAddress) {
    return (
      <p className="text-sm text-muted">
        Signed in as <span className="font-mono text-foreground">{formatAddress(sessionAddress)}</span>
        {identity?.email ? <span> · {identity.email}</span> : null}
      </p>
    );
  }

  const busy = phase === "connecting" || phase === "signing";
  const buttonClass =
    variant === "text"
      ? "text-sm text-muted hover:text-foreground hover:underline"
      : "rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02] disabled:state-disabled disabled:scale-100";
  const secondaryClass =
    "rounded-pill border border-border-input px-6 py-3 text-sm font-medium text-foreground hover:bg-surface-2 disabled:state-disabled";

  return (
    <div className="flex flex-col items-center gap-2">
      {layout === "split" ? (
        <>
          <button type="button" onClick={start} disabled={busy} className={buttonClass}>
            {busy ? signingLabel : "Continue with email"}
          </button>
          <button type="button" onClick={start} disabled={busy} className={secondaryClass}>
            {busy ? signingLabel : "Use a crypto wallet"}
          </button>
        </>
      ) : (
        <button type="button" onClick={start} disabled={busy} className={buttonClass}>
          {busy ? signingLabel : "Sign in"}
        </button>
      )}
      <p className="max-w-xs text-center text-xs text-muted">
        {hint ?? "Use your email or a wallet. Nothing is sent onchain."}
      </p>
      {error && (
        <p role="alert" className="max-w-xs text-center text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
