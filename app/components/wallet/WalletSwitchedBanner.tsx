"use client";

import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { queryClient } from "../../src/query/client";
import { signOut } from "../../src/app/app/siwe/actions";
import { formatAddress } from "../../src/format/address";
import { signOutEverywhere } from "../session/signOutEverywhere";
import { useSignIn } from "./signInContext";

/// Shown when the browser's connected wallet changes to another account while Contraflow stays
/// signed in as the first one (switching accounts inside MetaMask doesn't sign anyone out). The
/// session never follows the wallet by itself: that is the safe default, so it says so and offers
/// the switch.
export function WalletSwitchedBanner() {
  const { sessionAddress } = useSignIn();
  const { address } = useAccount();
  const { wallets } = useWallets();
  const { logout } = usePrivy();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Stay as" holds only while the wallet stays on that account. Back on the session's account, the
  // choice is forgotten, so the next switch away shows the banner again without a reload.
  const backOnSession = Boolean(address && sessionAddress && address.toLowerCase() === sessionAddress.toLowerCase());
  useEffect(() => {
    if (backOnSession) setDismissedFor(null);
  }, [backOnSession]);

  if (!sessionAddress || !address) return null;
  if (address.toLowerCase() === sessionAddress.toLowerCase()) return null;
  // The account's own embedded wallet is never "another account".
  const known = wallets.find((w) => w.address.toLowerCase() === address.toLowerCase());
  if (known?.walletClientType?.startsWith("privy")) return null;
  if (dismissedFor === address.toLowerCase()) return null;

  async function switchAccount() {
    setBusy(true);
    setError(null);
    const result = await signOutEverywhere({
      signOut,
      logout,
      // The new account stays connected, so it is on the list when the sign-in dialog opens.
      disconnect: async () => undefined,
      queryClient,
      then: "switch",
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[90] border-t border-border-subtle bg-surface-1 px-4 py-3 text-sm sm:px-6"
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <p className="text-muted">
          Your wallet is now on <span className="font-mono text-foreground">{formatAddress(address)}</span>, but Contraflow
          is signed in as <span className="font-mono text-foreground">{formatAddress(sessionAddress)}</span>.
          {error ? <span className="text-danger"> {error}</span> : null}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void switchAccount()}
            className="rounded-pill bg-gold px-4 py-2 text-sm font-medium text-black disabled:state-disabled"
          >
            {busy ? "Switching…" : "Sign in with this account"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setDismissedFor(address.toLowerCase())}
            className="text-xs text-muted hover:underline"
          >
            Stay as {formatAddress(sessionAddress)}
          </button>
        </div>
      </div>
    </div>
  );
}
