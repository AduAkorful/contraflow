"use client";

/// Everything shown here is read fresh from Circle and the chains on each visit, so nothing is lost
/// if the page closes mid-way: a deposit that landed shows as confirming, then as confirmed, ready
/// to move. Reads retry quietly; deposits and moves only ever happen on a click.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { readGatewayBalances, walletUsdc } from "../../../src/kits/browserAdapter";
import { fromBaseUnits, parseGatewayBalances, toBaseUnits, type GatewayBalanceView } from "../../../src/kits/gatewayBalance";
import { gatewayArcChain, networkTypeForChainId } from "../../../src/kits/gatewayChains";
import { roundDecimalString } from "../../../src/kits/quoteFormat";
import { DepositPanel } from "./DepositPanel";
import { MovePanel } from "./MovePanel";
import { useOwnerWallet } from "./wallet";

const READ_ATTEMPTS = 3;
const PENDING_POLL_MS = 30_000;

async function withQuietRetry<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function BalanceClient({ owner, arcChainId }: { owner: `0x${string}`; arcChainId: number }) {
  const arc = useMemo(() => gatewayArcChain(arcChainId), [arcChainId]);
  const wallet = useOwnerWallet(owner);
  const { connectWallet } = usePrivy();

  const [balances, setBalances] = useState<GatewayBalanceView | "loading" | "error">("loading");
  const [arcWallet, setArcWallet] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await withQuietRetry(() => readGatewayBalances(owner, networkTypeForChainId(arcChainId)));
      setBalances(parseGatewayBalances(raw, arcChainId));
    } catch (error) {
      console.error("Gateway balance read failed:", error);
      setBalances((current) => (typeof current === "object" ? current : "error"));
    }
    walletUsdc(arc, owner)
      .then((units) => setArcWallet(fromBaseUnits(units)))
      .catch(() => setArcWallet(null));
  }, [owner, arcChainId, arc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasPending = typeof balances === "object" && toBaseUnits(balances.totalPending) > 0n;
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => void refresh(), PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [hasPending, refresh]);

  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-card border border-white/10 bg-white/[0.02] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Your Circle Gateway balance</h2>
          <button type="button" onClick={() => void refresh()} className="text-xs text-gold hover:underline">
            Refresh
          </button>
        </div>

        {balances === "loading" && <div className="animate-skeleton mt-4 h-8 w-40 rounded" aria-hidden="true" />}
        {balances === "error" && (
          <p className="mt-4 text-sm text-muted">Couldn&apos;t load your balance from Circle right now. Try Refresh.</p>
        )}
        {typeof balances === "object" && (
          <>
            <p className="mt-3 font-serif-display text-3xl tabular-nums">
              {roundDecimalString(balances.totalConfirmed, 2)} <span className="text-base text-muted">USDC</span>
            </p>
            {hasPending && (
              <p className="mt-1 text-xs text-muted">
                Plus {balances.totalPending} USDC confirming. This page checks again every 30 seconds, and you can
                leave and come back.
              </p>
            )}
            {balances.rows.length > 0 ? (
              <ul className="mt-4 divide-y divide-white/10 text-sm">
                {balances.rows.map((row) => (
                  <li key={row.chain} className="flex items-center justify-between gap-4 py-2.5">
                    <span className="text-foreground/90">{row.known?.name ?? row.chain.replaceAll("_", " ")}</span>
                    <span className="text-right tabular-nums" title={`${row.confirmed} USDC confirmed`}>
                      {roundDecimalString(row.confirmed, 2)} USDC
                      {toBaseUnits(row.pending) > 0n && (
                        <span className="block text-xs text-muted">+{row.pending} confirming</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">Nothing deposited yet.</p>
            )}
          </>
        )}
        <p className="mt-4 border-t border-white/10 pt-4 text-xs text-muted">
          In your wallet on {arc.name}:{" "}
          <span className="tabular-nums text-foreground/90">{arcWallet === null ? "…" : `${roundDecimalString(arcWallet, 2)} USDC`}</span>
        </p>
      </div>

      {wallet.status === "disconnected" && (
        <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="text-sm text-muted">Connect the wallet you signed in with ({shortAddr(owner)}) to deposit or move USDC.</p>
          <button type="button" onClick={() => connectWallet()} className="mt-3 text-sm text-gold hover:underline">
            Connect wallet
          </button>
        </div>
      )}
      {wallet.status === "mismatch" && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Your wallet is connected as {shortAddr(wallet.connected)}, but you signed in as {shortAddr(owner)}. Switch
          accounts in your wallet to continue.
        </p>
      )}
      {wallet.status === "ready" && (
        <>
          <DepositPanel owner={owner} arcChainId={arcChainId} wallet={wallet} onDone={refresh} />
          <MovePanel
            owner={owner}
            arcChainId={arcChainId}
            wallet={wallet}
            balances={typeof balances === "object" ? balances : null}
            onDone={refresh}
          />
        </>
      )}
    </div>
  );
}
