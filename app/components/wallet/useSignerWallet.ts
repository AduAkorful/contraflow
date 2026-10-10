"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useSignIn } from "./useSignIn";

export type SignerWalletState = "ready" | "syncing" | "mismatch" | "disconnected";

/// How long to wait for the wallet tree to attach the signed-in wallet before showing a message.
const SETTLE_MS = 2500;

/// Tells a composer whether the wallet that will sign is the signed-in account, and attaches the
/// signed-in wallet by itself when Privy already holds it. A page shows its form straight away and
/// only needs this when the user is about to sign, so a slow wallet start never hides the page.
export function useSignerWallet(signerAddress: string) {
  const { address, isConnected, status } = useAccount();
  const { wallets, ready } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { start } = useSignIn();
  const [settled, setSettled] = useState(false);
  const attached = useRef<string | null>(null);

  const signer = signerAddress.toLowerCase();
  const match = wallets.find((w) => w.address.toLowerCase() === signer);
  const matches = isConnected && address?.toLowerCase() === signer;

  useEffect(() => {
    if (matches || !match || attached.current === match.address) return;
    attached.current = match.address;
    void setActiveWallet(match).catch(() => {
      attached.current = null;
    });
  }, [matches, match, setActiveWallet]);

  useEffect(() => {
    if (matches) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [matches, address]);

  let state: SignerWalletState;
  if (matches) state = "ready";
  else if (!settled || !ready || status === "connecting" || status === "reconnecting" || (isConnected && !address)) {
    state = "syncing";
  } else if (isConnected && address) state = "mismatch";
  else state = "disconnected";

  function connect() {
    if (match) void setActiveWallet(match);
    else start();
  }

  return { state, connect, connectedAddress: address ?? null };
}
