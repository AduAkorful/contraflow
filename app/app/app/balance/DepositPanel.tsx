"use client";

import { useEffect, useState } from "react";

import { deposit, estimateDeposit, isUnsupportedSmartAccount, walletCode, walletUsdc } from "../../../src/kits/browserAdapter";
import { checkUsdcAmount, feeLabel, fromBaseUnits, type FeeLine } from "../../../src/kits/gatewayBalance";
import { explorerTxLink, gatewaySourceChains, type GatewayChain } from "../../../src/kits/gatewayChains";
import { roundDecimalString } from "../../../src/kits/quoteFormat";
import { walletErrorMessage, type WalletState } from "./wallet";

type Ready = Extract<WalletState, { status: "ready" }>;

interface Review {
  chain: GatewayChain;
  amount: string;
  fees: FeeLine[];
}

export function DepositPanel({
  owner,
  arcChainId,
  wallet,
  onDone,
}: {
  owner: `0x${string}`;
  arcChainId: number;
  wallet: Ready;
  onDone: () => Promise<void>;
}) {
  const chains = gatewaySourceChains(arcChainId);
  const [chainName, setChainName] = useState(chains[0]?.chain ?? "");
  const [amount, setAmount] = useState("");
  const [held, setHeld] = useState<bigint | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ chain: GatewayChain; amount: string; txHash: string } | null>(null);
  const [heldVersion, setHeldVersion] = useState(0);

  const chain = chains.find((c) => c.chain === chainName);

  useEffect(() => {
    setHeld(null);
    if (!chain) return;
    let current = true;
    walletUsdc(chain, owner)
      .then((units) => current && setHeld(units))
      .catch(() => current && setHeld(null));
    return () => {
      current = false;
    };
  }, [chain, owner, heldVersion]);

  // Any edit invalidates the reviewed figures, so the deposit always matches what was shown.
  function edit(update: () => void) {
    update();
    setReview(null);
    setError(null);
  }

  async function handleReview() {
    if (!chain) return;
    const check = checkUsdcAmount(amount, held ?? undefined);
    if (!check.ok) return setError(check.error);
    setError(null);
    setBusy("Checking fees…");
    try {
      if (isUnsupportedSmartAccount(await walletCode(chain, owner))) {
        setError("This wallet type isn't supported yet. Use a regular wallet account.");
        return;
      }
      const fees = await estimateDeposit(await wallet.adapter(), chain, check.amount);
      setReview({ chain, amount: check.amount, fees });
    } catch (err) {
      console.error("estimateDeposit failed:", err);
      setError(walletErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeposit() {
    if (!review) return;
    setError(null);
    setBusy("Confirm in your wallet: you may be asked to sign an authorization, then to send the deposit.");
    try {
      await wallet.switchTo(review.chain);
      const { txHash } = await deposit(await wallet.adapter(), review.chain, review.amount);
      setSent({ chain: review.chain, amount: review.amount, txHash });
      setReview(null);
      setAmount("");
    } catch (err) {
      console.error("deposit failed:", err);
      setError(walletErrorMessage(err));
    } finally {
      setBusy(null);
      await wallet.returnTo(arcChainId);
      setHeldVersion((v) => v + 1);
      await onDone();
    }
  }

  return (
    <div className="rounded-card border border-white/10 bg-white/[0.02] p-6">
      <h2 className="text-sm font-medium">1. Deposit into Circle Gateway</h2>
      <p className="mt-1 text-xs text-muted">From your wallet on another chain. Your wallet pays that chain&apos;s network fee.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="text-xs text-muted">
          From
          <select
            value={chainName}
            onChange={(e) => edit(() => setChainName(e.target.value))}
            disabled={busy !== null}
            className="mt-1 block w-full rounded-lg border border-white/15 bg-bg px-3 py-2 text-sm text-foreground"
          >
            {chains.map((c) => (
              <option key={c.chain} value={c.chain}>
                {c.name}
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
      <p className="mt-2 text-xs text-muted">
        In your wallet on {chain?.name}:{" "}
        {held === null ? "…" : <span className="tabular-nums text-foreground/90">{roundDecimalString(fromBaseUnits(held), 2)} USDC</span>}
      </p>

      {review && (
        <div className="mt-4 rounded-lg border border-white/10 px-4 py-3 text-sm">
          <p>
            Deposit <span className="tabular-nums">{review.amount} USDC</span> from {review.chain.name}
          </p>
          {review.fees.map((fee, i) => (
            <p key={i} className="mt-1 text-xs text-muted">
              {feeLabel(fee.type)} on {review.chain.name}: about {roundDecimalString(fee.amount, 8)} {fee.token}, paid from your
              wallet
            </p>
          ))}
        </div>
      )}

      {error && <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {busy && <p className="mt-4 text-sm text-muted" aria-live="polite">{busy}</p>}
      {sent && !busy && (
        <p className="mt-4 text-sm text-muted" aria-live="polite">
          Deposit of {sent.amount} USDC sent on {sent.chain.name}. It shows as confirming above until Circle confirms it,
          which can take several minutes. You can leave this page and come back.{" "}
          <a href={explorerTxLink(sent.chain, sent.txHash)} target="_blank" rel="noreferrer" className="text-gold hover:underline">
            View transaction →
          </a>
        </p>
      )}

      <div className="mt-4">
        {review ? (
          <button
            type="button"
            onClick={handleDeposit}
            disabled={busy !== null}
            className="rounded-pill bg-gold px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Deposit {review.amount} USDC
          </button>
        ) : (
          <button
            type="button"
            onClick={handleReview}
            disabled={busy !== null || amount.trim() === ""}
            className="rounded-pill border border-white/15 px-5 py-2 text-sm hover:border-white/30 disabled:opacity-50"
          >
            Review deposit
          </button>
        )}
      </div>
    </div>
  );
}
