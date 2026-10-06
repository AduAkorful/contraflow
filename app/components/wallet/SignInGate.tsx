"use client";

import { ConnectButton } from "./ConnectButton";
import { useSignIn } from "./useSignIn";

/// The one signed-out card for `/app/...` pages. Signs in in place, then the server refresh shows
/// the page. Share-link pages use the same control and never navigate away.
export function SignInGate({
  title = "Sign in to continue",
  reason,
  sender,
  intendedSigner,
}: {
  title?: string;
  reason: string;
  sender?: string;
  intendedSigner?: string;
}) {
  const { phase, sessionAddress } = useSignIn();
  if (phase === "signed-in" && sessionAddress) {
    return (
      <div className="mt-8 rounded-card border border-border-subtle bg-surface-1 p-6 text-center">
        <p className="text-sm text-muted">Signed in. Loading…</p>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-card border border-border-subtle bg-surface-1 p-6 text-center">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted">{reason}</p>
      {(sender || intendedSigner) && (
        <p className="mt-2 font-mono text-xs text-faint">
          {sender ? `From ${sender}` : null}
          {sender && intendedSigner ? " · " : null}
          {intendedSigner ? `For ${intendedSigner}` : null}
        </p>
      )}
      <div className="mt-4">
        <ConnectButton />
      </div>
    </div>
  );
}
