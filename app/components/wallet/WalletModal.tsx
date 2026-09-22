"use client";

/// The connect-wallet surface: a centered dialog listing every real detected wallet as its own
/// row, plus an alternative sign-in path below a divider. Wallet discovery uses
/// `useConnectors()`, not `useConnect().connectors`, filtering out the generic "injected"
/// duplicate whenever a named (EIP-6963) connector exists. The email/Circle UCW option lives in
/// this same dialog, though it still shows "not configured yet" until a real
/// `NEXT_PUBLIC_CIRCLE_APP_ID` exists — rendering it here doesn't unblock what it does.

import { useEffect } from "react";
import { useConnectors, useConnect, ProviderNotFoundError } from "wagmi";
import type { Connector } from "wagmi";
import { useState } from "react";
import { UcwSignIn } from "./UcwSignIn";

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const discovered = useConnectors();
  const namedConnectors = discovered.filter((c) => c.id !== "injected");
  const connectors = namedConnectors.length > 0 ? namedConnectors : discovered;
  const { connectAsync } = useConnect();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function connectWith(connector: Connector) {
    setError(null);
    setConnectingId(connector.id);
    try {
      await connectAsync({ connector });
      onClose();
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
        setError("No browser wallet found — install MetaMask or another EIP-1193 wallet extension.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to connect.");
      }
    } finally {
      setConnectingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        className="w-full max-w-sm rounded-card border border-white/10 bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="wallet-modal-title" className="text-sm font-medium">
            Connect a wallet
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-muted hover:bg-white/[0.06] hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-1">
          {connectors.length === 0 && (
            <p className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-center text-xs text-muted">
              No browser wallet found — install MetaMask or another EIP-1193 wallet extension.
            </p>
          )}
          {connectors.map((connector) => (
            <button
              key={connector.id}
              onClick={() => connectWith(connector)}
              disabled={connectingId !== null}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors hover:bg-white/[0.05] disabled:opacity-50"
            >
              {connector.icon && (
                // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data: URI, not a static asset Next's optimizer can process
                // alt="" is correct: connector.name renders as visible text right beside it, so the
                // icon is decorative — a real alt would make a screen reader announce the name twice.
                <img src={connector.icon} alt="" className="h-7 w-7 shrink-0 rounded" />
              )}
              <span className="flex-1">{connector.name}</span>
              {connectingId === connector.id && <span className="text-xs text-muted">Connecting…</span>}
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-center text-xs text-red-300">{error}</p>}

        <div className="mt-4 flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-white/10" />
          or
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <div className="mt-4">
          <UcwSignIn />
        </div>

        <p className="mt-4 text-center text-[11px] text-muted">
          Connecting proves who you are with a signature — nothing is typed or trusted from a form.
        </p>
      </div>
    </div>
  );
}
