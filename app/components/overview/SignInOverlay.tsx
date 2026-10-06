"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { NetworkNotice } from "../network/NetworkNotice";
import { OVERVIEW_ILLUSTRATION_CAPTION } from "./OverviewIllustration";
import { ConnectButton } from "../wallet/ConnectButton";
import { useSignIn, useWalletReady } from "../wallet/signInContext";

const STEPS = [
  { title: "Sign in", body: "Email or a wallet. One signature, no transaction." },
  { title: "Record a debt", body: "A USDC invoice on Arc, or an obligation in any currency." },
  { title: "Share the link", body: "Your counterparty signs the same terms." },
  { title: "Net a loop", body: "When debts close a circle, settle from Overview." },
] as const;

export function SignInOverlay({ next, autoStart = false }: { next: string | null; autoStart?: boolean }) {
  const router = useRouter();
  const { start, phase, sessionAddress } = useSignIn();
  const walletReady = useWalletReady();
  const started = useRef(false);

  useEffect(() => {
    if (!autoStart || !walletReady || started.current || phase !== "idle") return;
    started.current = true;
    start();
  }, [autoStart, walletReady, phase, start]);

  useEffect(() => {
    if (sessionAddress && next) router.push(next);
  }, [sessionAddress, next, router]);

  return (
    <div className="relative mx-auto w-full max-w-md rounded-card border border-border-subtle bg-surface-1 p-6 text-center shadow-lg sm:p-8">
      <NetworkNotice className="text-sm font-medium text-gold" />
      <h1 className="heading-1 mt-3">Sign in to start netting</h1>
      <div className="mt-6">
        <ConnectButton layout="split" />
      </div>
      <ol className="mt-8 space-y-3 text-left text-sm">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border-input text-xs text-muted"
            >
              {index + 1}
            </span>
            <div>
              <p className="font-medium">{step.title}</p>
              <p className="mt-0.5 text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-xs text-faint">{OVERVIEW_ILLUSTRATION_CAPTION}</p>
    </div>
  );
}
