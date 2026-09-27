"use client";

import { useState } from "react";

import { estimateMoveToArc, moveToArc } from "../../../src/kits/browserAdapter";
import {
  checkUsdcAmount,
  feeLabel,
  fromBaseUnits,
  toBaseUnits,
  usdcFeeTotal,
  type FeeLine,
  type GatewayBalanceView,
} from "../../../src/kits/gatewayBalance";
import { explorerTxLink, gatewayArcChain, type GatewayChain } from "../../../src/kits/gatewayChains";
import { walletErrorMessage, type WalletState } from "./wallet";

type Ready = Extract<WalletState, { status: "ready" }>;

interface Review {
  source: GatewayChain;
  amount: string;
  fees: FeeLine[];
  feeTotal: bigint;
}

export function MovePanel({
  owner,
  arcChainId,
  wallet,
  balances,
  onDone,
}: {
  owner: `0x${string}`;
  arcChainId: number;
  wallet: Ready;
  balances: GatewayBalanceView | null;
  onDone: () => Promise<void>;
}) {
  const arc = gatewayArcChain(arcChainId);
  const sources = (balances?.rows ?? []).filter(
    (row): row is typeof row & { known: GatewayChain } =>
      row.known !== undefined && row.known.chain !== arc.chain && toBaseUnits(row.confirmed) > 0n,
  );

  const [chainName, setChainName] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ amount: string; txHash: string } | null>(null);

  const selected = sources.find((row) => row.chain === chainName) ?? sources[0];

  function edit(update: () => void) {
    update();
    setReview(null);
    setError(null);
  }

  async function handleReview() {
    if (!selected) return;
    const available = toBaseUnits(selected.confirmed);
    const check = checkUsdcAmount(amount, available);
    if (!check.ok) return setError(check.error);
    setError(null);
    setBusy("Checking fees…");
    try {
      const fees = await estimateMoveToArc(await wallet.adapter(), selected.known, arc, owner, check.amount);
      const feeTotal = usdcFeeTotal(fees);
      if (check.baseUnits + feeTotal > available) {
        const most = available > feeTotal ? fromBaseUnits(available - feeTotal) : null;
        setError(
          `Fees for this move are about ${fromBaseUnits(feeTotal)} USDC, and they come out of your confirmed balance on ` +
            `${selected.known.name} too. ` +
            (most ? `The most you can move from there now is about ${most} USDC.` : "Deposit more before moving."),
        );
        return;
      }
      setReview({ source: selected.known, amount: check.amount, fees, feeTotal });
    } catch (err) {
      console.error("estimateSpend failed:", err);
      setError(walletErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleMove() {
    if (!review) return;
    setError(null);
    setBusy("Confirm in your wallet, then wait while Circle delivers the USDC to Arc. This can take a minute or two.");
    try {
      await wallet.switchTo(review.source);
      const { txHash } = await moveToArc(await wallet.adapter(), review.source, arc, owner, review.amount);
      setSent({ amount: review.amount, txHash });
      setReview(null);
      setAmount("");
    } catch (err) {
      console.error("spend failed:", err);
      setError(walletErrorMessage(err));
    } finally {
      setBusy(null);
      await wallet.returnTo(arcChainId);
      await onDone();
    }
  }

  return (
    <div className="rounded-card border border-white/10 bg-white/[0.02] p-6">
      <h2 className="text-sm font-medium">2. Move to your wallet on {arc.name}</h2>
      <p className="mt-1 text-xs text-muted">
        From your confirmed Gateway balance. You don&apos;t need gas on {arc.name}: Circle delivers the USDC to your own
        address.
      </p>

      {sources.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing confirmed to move yet. Deposits appear here once Circle confirms them.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem]">
            <label className="text-xs text-muted">
              From
              <select
                value={selected?.chain}
                onChange={(e) => edit(() => setChainName(e.target.value))}
                disabled={busy !== null}
                className="mt-1 block w-full rounded-lg border border-white/15 bg-bg px-3 py-2 text-sm text-foreground"
              >
                {sources.map((row) => (
                  <option key={row.chain} value={row.chain}>
                    {row.known.name}: {row.confirmed} USDC
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Amount (USDC)
              <input
                value={amount}
                onChange={(e) => edit(() => setAmount(e.target.value))}
                inputMode="decimal"
                placeholder="0.00"
                disabled={busy !== null}
                className="mt-1 block w-full rounded-lg border border-white/15 bg-bg px-3 py-2 text-sm tabular-nums text-foreground"
              />
            </label>
          </div>

          {review && (
            <div className="mt-4 rounded-lg border border-white/10 px-4 py-3 text-sm">
              <p>
                Move <span className="tabular-nums">{review.amount} USDC</span> from {review.source.name} to your wallet on{" "}
                {arc.name}
              </p>
              {review.fees.map((fee, i) => (
                <p key={i} className="mt-1 text-xs text-muted">
                  {feeLabel(fee.type)}: about {fee.amount} {fee.token}
                </p>
              ))}
              <p className="mt-2 text-xs text-muted">
                Circle estimates fees of about {fromBaseUnits(review.feeTotal)} USDC, taken from your Gateway balance on{" "}
                {review.source.name} on top of the amount. The final fee can be lower. You receive the full amount on {arc.name}.
              </p>
            </div>
          )}

          <div className="mt-4">
            {review ? (
              <button
                type="button"
                onClick={handleMove}
                disabled={busy !== null}
                className="rounded-pill bg-gold px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                Move {review.amount} USDC to {arc.name}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleReview}
                disabled={busy !== null || amount.trim() === ""}
                className="rounded-pill border border-white/15 px-5 py-2 text-sm hover:border-white/30 disabled:opacity-50"
              >
                Review move
              </button>
            )}
          </div>
        </>
      )}

      {error && <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {busy && <p className="mt-4 text-sm text-muted" aria-live="polite">{busy}</p>}
      {sent && !busy && (
        <p className="mt-4 text-sm text-muted" aria-live="polite">
          {sent.amount} USDC sent to your wallet on {arc.name}.{" "}
          <a href={explorerTxLink(arc, sent.txHash)} target="_blank" rel="noreferrer" className="text-gold hover:underline">
            View transaction →
          </a>
        </p>
      )}
    </div>
  );
}
