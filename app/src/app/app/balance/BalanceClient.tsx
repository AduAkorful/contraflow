"use client";

/// Everything shown here is read fresh from Circle and the chains on each visit, so nothing is lost
/// if the page closes mid-way: a deposit that landed shows as confirming, then as confirmed, ready
/// to move. Reads retry quietly; deposits and moves only ever happen on a click.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

import { readGatewayBalances, walletUsdc } from "@/src/kits/browserAdapter";
import { fromBaseUnits, parseGatewayBalances, toBaseUnits, type GatewayBalanceView } from "@/src/kits/gatewayBalance";
import { gatewayArcChain, networkTypeForChainId } from "@/src/kits/gatewayChains";
import { Money } from "@/components/ui/Money";
import { formatAddress } from "@/src/format/address";
import { roundDecimalString } from "@/src/kits/quoteFormat";
import { DepositPanel } from "./DepositPanel";
import { MovePanel } from "./MovePanel";
import { SendCard } from "@/components/send/SendCard";
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


type Tab = "deposit" | "move" | "send";

export function BalanceClient({
  owner,
  arcChainId,
  chainName,
  gatewayEnabled,
  initialTab,
  initialTo,
}: {
  owner: `0x${string}`;
  arcChainId: number;
  chainName: string;
  gatewayEnabled: boolean;
  initialTab: Tab;
  initialTo: string;
}) {
  const arc = useMemo(() => gatewayArcChain(arcChainId), [arcChainId]);
  const wallet = useOwnerWallet(owner);
  const { connectWallet } = usePrivy();

  const [balances, setBalances] = useState<GatewayBalanceView | "loading" | "error">("loading");
  const [arcWallet, setArcWallet] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);

  const refresh = useCallback(async () => {
    if (gatewayEnabled) {
      try {
        const raw = await withQuietRetry(() => readGatewayBalances(owner, networkTypeForChainId(arcChainId)));
        setBalances(parseGatewayBalances(raw, arcChainId));
      } catch (error) {
        console.error("Gateway balance read failed:", error);
        setBalances((current) => (typeof current === "object" ? current : "error"));
      }
    }
    walletUsdc(arc, owner)
      .then((units) => setArcWallet(fromBaseUnits(units)))
      .catch(() => setArcWallet(null));
  }, [owner, arcChainId, arc, gatewayEnabled]);

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
      <div className={`grid gap-px overflow-hidden rounded-[20px] border border-border-subtle bg-border-subtle ${gatewayEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
        {gatewayEnabled && (
        <div className="bg-surface-1 p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">Circle Gateway balance</p>
            <button type="button" onClick={() => void refresh()} className="text-xs text-gold hover:underline">
              Refresh
            </button>
          </div>
          {balances === "loading" && <div className="animate-skeleton mt-2 h-7 w-28 rounded" aria-hidden="true" />}
          {balances === "error" && <p className="mt-2 text-sm text-muted">Couldn&apos;t load. Try Refresh.</p>}
          {typeof balances === "object" && (
            <>
              <p className="mt-2 figure text-2xl">
                <Money value={roundDecimalString(balances.totalConfirmed, 2)} unit={false} />{" "}
                <span className="text-sm text-muted">USDC</span>
              </p>
              {hasPending && (
                <p className="mt-1 text-xs text-muted">+{balances.totalPending} confirming. Checked every 30 seconds.</p>
              )}
            </>
          )}
        </div>
        )}
        <div className="bg-surface-1 p-5">
          <p className="text-xs text-muted">In your wallet on {arc.name}</p>
          <p className="mt-2 figure text-2xl">
            {arcWallet === null ? "…" : roundDecimalString(arcWallet, 2)} <span className="text-sm text-muted">USDC</span>
          </p>
        </div>
      </div>

      {gatewayEnabled && typeof balances === "object" && balances.rows.length > 0 && (
        <details className="rounded-[20px] border border-border-subtle bg-surface-1 px-5 py-3">
          <summary className="cursor-pointer text-sm text-muted">Gateway balance by chain</summary>
          <ul className="mt-2 divide-y divide-border-subtle text-sm">
            {balances.rows.map((row) => (
              <li key={row.chain} className="flex items-center justify-between gap-4 py-2.5">
                <span>{row.known?.name ?? row.chain.replaceAll("_", " ")}</span>
                <span className="text-right tabular-nums" title={`${row.confirmed} USDC confirmed`}>
                  {roundDecimalString(row.confirmed, 2)} USDC
                  {toBaseUnits(row.pending) > 0n && <span className="block text-xs text-muted">+{row.pending} confirming</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {wallet.status === "disconnected" && (
        <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="text-sm text-muted">Connect the wallet you signed in with ({formatAddress(owner)}) to deposit or move USDC.</p>
          <button type="button" onClick={() => connectWallet()} className="mt-3 text-sm text-gold hover:underline">
            Connect wallet
          </button>
        </div>
      )}
      {wallet.status === "mismatch" && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Your wallet is connected as {formatAddress(wallet.connected)}, but you signed in as {formatAddress(owner)}. Switch
          accounts in your wallet to continue.
        </p>
      )}
      {wallet.status === "ready" && (
        <div className="rounded-[28px] border border-border-subtle bg-surface-1 p-3 sm:p-4">
          <div role="tablist" aria-label="Bring USDC" className="mb-4 flex gap-1 rounded-[20px] bg-black/50 p-1">
            {(
              [
                ...(gatewayEnabled
                  ? ([
                      ["deposit", "Deposit"],
                      ["move", `Move to ${arc.name}`],
                    ] as const)
                  : []),
                ["send", "Send"],
              ] as readonly (readonly [Tab, string])[]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 rounded-2xl px-3 py-2.5 text-sm ${
                  tab === id
                    ? "border border-border-subtle bg-surface-2 font-medium text-foreground"
                    : "border border-transparent text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {gatewayEnabled && (
            <>
              <div className="px-1 pb-1 sm:px-2" hidden={tab !== "deposit"}>
                <DepositPanel owner={owner} arcChainId={arcChainId} wallet={wallet} onDone={refresh} />
              </div>
              <div className="px-1 pb-1 sm:px-2" hidden={tab !== "move"}>
                <MovePanel
                  owner={owner}
                  arcChainId={arcChainId}
                  wallet={wallet}
                  balances={typeof balances === "object" ? balances : null}
                  onDone={refresh}
                />
              </div>
            </>
          )}
          <div className="px-1 pb-1 sm:px-2" hidden={tab !== "send"}>
            <SendCard owner={owner} chainId={arcChainId} chainName={chainName} initialTo={initialTo} onSent={refresh} />
          </div>
        </div>
      )}
    </div>
  );
}
