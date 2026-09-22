"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { buildSiweMessage } from "../../src/siwe/message";
import { requestNonce, signIn, signOut, whoAmI } from "../../app/app/siwe/actions";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type Phase = "idle" | "signing" | "signed-in" | "error";

export function ConnectButton({ signedInExtra }: { signedInExtra?: React.ReactNode } = {}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { login, logout } = usePrivy();

  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    whoAmI().then((r) => {
      if (r.address) {
        setSessionAddress(r.address);
        setPhase("signed-in");
      }
    });
  }, []);

  async function handleSignIn() {
    if (!address) return;
    setError(null);
    setPhase("signing");
    try {
      const { nonce, domain, uri } = await requestNonce();
      const now = new Date();
      const message = buildSiweMessage({
        domain,
        address: address as `0x${string}`,
        statement: "Sign in to Contraflow.",
        uri,
        chainId: 5042002,
        nonce,
        issuedAt: now.toISOString(),
        expirationTime: new Date(now.getTime() + 5 * 60_000).toISOString(),
      });
      const signature = await signMessageAsync({ message });
      const result = await signIn(message, signature);
      if (!result.ok) {
        setError(result.error);
        setPhase("error");
        return;
      }
      setSessionAddress(result.address);
      setPhase("signed-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in.");
      setPhase("error");
    }
  }

  async function handleSignOut() {
    await signOut();
    await logout();
    setSessionAddress(null);
    setPhase("idle");
  }

  if (phase === "signed-in" && sessionAddress) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-pill border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-mono text-gold">
            {shortAddr(sessionAddress)}
          </span>
          <button
            onClick={handleSignOut}
            className="rounded-pill border border-white/15 px-4 py-1.5 text-xs text-muted hover:border-white/30"
          >
            Sign out
          </button>
        </div>
        {signedInExtra}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {!isConnected ? (
        <button
          onClick={() => {
            setError(null);
            login();
          }}
          className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
        >
          Connect Wallet
        </button>
      ) : (
        <button
          onClick={handleSignIn}
          disabled={phase === "signing"}
          className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02] disabled:opacity-40"
        >
          {phase === "signing" ? "Sign in your wallet..." : `Sign in as ${shortAddr(address ?? "")}`}
        </button>
      )}
      {error && <p className="max-w-xs text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}
