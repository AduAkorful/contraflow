"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { pageNeedsWallet } from "../../src/session/primarySignInPath";
import { idleSignInApi, SignInApiProvider } from "./signInContext";

const WalletProviders = dynamic(() => import("@/src/app/app/providers").then((m) => m.Providers), { ssr: true });

/// Wraps `/app/*`. Privy/wagmi load when a session exists, when the page mounts wallet hooks, or
/// when someone clicks Sign in — not on History, Receipt, Verify, Demo, or signed-out Overview.
export function WalletHost({
  hasSession,
  sessionAddress,
  children,
}: {
  hasSession: boolean;
  sessionAddress: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [requested, setRequested] = useState(false);
  const [pendingSignIn, setPendingSignIn] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("switch") === "1") setRequested(true);
  }, []);

  const requestAndSignIn = useCallback(() => {
    setPendingSignIn(true);
    setRequested(true);
  }, []);

  const needed = hasSession || requested || pageNeedsWallet(pathname);
  const stub = useMemo(
    () => idleSignInApi(requestAndSignIn, pendingSignIn || requested ? "connecting" : "idle"),
    [requestAndSignIn, pendingSignIn, requested],
  );

  if (!needed) {
    return (
      <SignInApiProvider value={stub} walletReady={false}>
        {children}
      </SignInApiProvider>
    );
  }

  return (
    <WalletProviders sessionAddress={sessionAddress} autoStartLogin={pendingSignIn}>
      {children}
    </WalletProviders>
  );
}
