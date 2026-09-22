"use client";

/// Circle UCW sign-in entry point — plans/22-circle-ucw-signing-method.md. **Genuinely untested
/// past `beginUcwSignIn` returning a real challengeId** (confirmed live, see that plan) — everything
/// from here down needs a real Circle Web3 Services App ID this session doesn't have. Written
/// against the client SDK's actual compiled types, not guessed; still flagged as unverified.

import { useState } from "react";
import { beginUcwSignIn, getUcwWallet } from "../../app/app/ucw/actions";

type Phase = "idle" | "starting" | "challenge" | "done" | "error" | "unconfigured";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function UcwSignIn() {
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>(appId ? "idle" : "unconfigured");
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  async function handleContinue() {
    if (!appId) return;
    setError(null);
    setPhase("starting");

    const result = await beginUcwSignIn(email);
    if (!result.ok) {
      setError(result.error);
      setPhase("error");
      return;
    }

    setPhase("challenge");
    try {
      // Dynamic import — this SDK touches `window`/iframes at module scope in places, so it must
      // never load during SSR (this file is already "use client", but the import itself is kept
      // lazy for the same reason `wagmi`'s own connectors are only ever exercised client-side).
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const sdk = new W3SSdk({ appSettings: { appId } });
      await sdk.getDeviceId();
      sdk.setAuthentication({ userToken: result.userToken, encryptionKey: result.encryptionKey });

      sdk.execute(result.challengeId, async (err, challengeResult) => {
        if (err || challengeResult?.status !== "COMPLETE") {
          setError(err?.message ?? "PIN setup was not completed.");
          setPhase("error");
          return;
        }
        const walletResult = await getUcwWallet(result.userToken);
        if (!walletResult.ok || !walletResult.wallet) {
          setError(walletResult.ok ? "No wallet found after setup." : walletResult.error);
          setPhase("error");
          return;
        }
        setWalletAddress(walletResult.wallet.address);
        setPhase("done");
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the Circle sign-in UI.");
      setPhase("error");
    }
  }

  if (phase === "unconfigured") {
    return <p className="text-xs text-muted">Email sign-in isn&apos;t configured yet.</p>;
  }

  if (phase === "done" && walletAddress) {
    return (
      <span className="rounded-pill border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-mono text-gold">
        {shortAddr(walletAddress)}
      </span>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="flex w-full gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={phase === "starting" || phase === "challenge"}
          className="min-w-0 flex-1 rounded-pill border border-white/15 bg-white/[0.02] px-4 py-2 text-sm outline-none focus:border-gold/50"
        />
        <button
          onClick={handleContinue}
          disabled={phase === "starting" || phase === "challenge" || !email.includes("@")}
          className="shrink-0 rounded-pill border border-white/15 px-4 py-2 text-sm text-muted hover:border-gold/50 disabled:opacity-40"
        >
          {phase === "starting" || phase === "challenge" ? "Continue in the popup..." : "Continue with email"}
        </button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
