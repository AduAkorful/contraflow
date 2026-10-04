"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { estimateMoveToArc, getForwarderStatus, moveToArc, retryMoveMint } from "../../../src/kits/browserAdapter";
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
import { prepareWalletContext } from "../../../src/attest/walletContext";
import {
  clearPendingGatewayMove,
  GATEWAY_RECOVERY_EVENT,
  gatewayMoveRecoveryFromError,
  readPendingGatewayMove,
  readPendingGatewayDeposit,
  savePendingGatewayMove,
  type PendingGatewayMove,
} from "../../../src/kits/gatewayRecovery";

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
  const { connector } = useAccount();
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
  const [pendingMove, setPendingMove] = useState<PendingGatewayMove | null>(null);
  const [recoveryNote, setRecoveryNote] = useState<string | null>(null);
  const [recoveryStorageReady, setRecoveryStorageReady] = useState(false);
  const [depositPending, setDepositPending] = useState(false);

  useEffect(() => {
    const sync = () => {
      try {
        setPendingMove(readPendingGatewayMove(window.localStorage, owner));
        setDepositPending(readPendingGatewayDeposit(window.localStorage, owner) !== null);
        setRecoveryStorageReady(true);
      } catch {
        setRecoveryStorageReady(false);
        setError("This browser cannot read Gateway recovery state. Moves are disabled until local storage is available.");
      }
    };
    sync();
    window.addEventListener(GATEWAY_RECOVERY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(GATEWAY_RECOVERY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [owner]);

  const selected = sources.find((row) => row.chain === chainName) ?? sources[0];

  function edit(update: () => void) {
    update();
    setReview(null);
    setError(null);
  }

  async function handleReview() {
    if (!recoveryStorageReady) return setError("This browser cannot verify Gateway recovery storage yet. Try again in a moment.");
    if (pendingMove || depositPending) return setError("Resolve the previous Gateway operation before starting another one.");
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
    if (!review || pendingMove || depositPending || !recoveryStorageReady) return;
    setError(null);
    setBusy("Confirm in your wallet, then wait while Circle delivers the USDC to Arc. This can take a minute or two.");
    try {
      await wallet.switchTo(review.source);
      await prepareWalletContext(connector, owner, review.source.chainId, async () => wallet.switchTo(review!.source));
      const record: PendingGatewayMove = {
        version: 1,
        operationId: crypto.randomUUID(),
        owner: owner.toLowerCase() as `0x${string}`,
        sourceChain: review.source.chain,
        arcChainId,
        recipient: owner,
        amountUsdc: review.amount,
        state: "submission_unknown",
        createdAt: Date.now(),
      };
      // This write must succeed before asking Circle or the wallet to submit a transfer. If the
      // browser cannot retain recovery state, fail closed before the user pays.
      savePendingGatewayMove(window.localStorage, record);
      setPendingMove(record);
      const { txHash } = await moveToArc(await wallet.adapter(), review.source, arc, owner, review.amount);
      clearPendingGatewayMove(window.localStorage, owner);
      setPendingMove(null);
      setSent({ amount: review.amount, txHash });
      setReview(null);
      setAmount("");
    } catch (err) {
      console.error("spend failed:", err);
      let existing: PendingGatewayMove | null = null;
      try {
        existing = readPendingGatewayMove(window.localStorage, owner);
      } catch {
        setError("The Gateway result is uncertain and this browser cannot read recovery state. Do not submit another move.");
        return;
      }
      if (existing) {
        const recovery = gatewayMoveRecoveryFromError(err);
        const next = { ...existing, ...recovery };
        try {
          savePendingGatewayMove(window.localStorage, next);
          setPendingMove(next);
          setRecoveryNote(recovery.state === "retry_mint"
            ? "The source transfer committed. Retry will submit only Circle's original mint."
            : recovery.state === "forwarder_pending"
              ? "The source transfer committed. This will check the same forwarding transfer."
              : "The result is uncertain. Do not submit another move while the original is being checked.");
        } catch {
          setError("The Gateway result is uncertain and this browser could not save recovery data. Do not submit another move.");
          return;
        }
      }
      setError(walletErrorMessage(err));
    } finally {
      setBusy(null);
      await wallet.returnTo(arcChainId);
      await onDone().catch((err) => console.error("Balance refresh failed after Gateway move:", err));
    }
  }

  async function handleRetryMint() {
    if (!pendingMove?.retryMint || pendingMove.state !== "retry_mint") return;
    setError(null);
    setBusy("Retrying the original mint…");
    const submitting = { ...pendingMove, state: "mint_retry_submitting" as const };
    try {
      savePendingGatewayMove(window.localStorage, submitting);
      setPendingMove(submitting);
    } catch {
      setBusy(null);
      setError("Recovery state could not be saved, so no mint retry was submitted.");
      return;
    }
    try {
      await wallet.switchTo(arc);
      await prepareWalletContext(connector, owner, arcChainId, async () => wallet.switchTo(arc));
      const { txHash } = await retryMoveMint(await wallet.adapter(), arc, owner, pendingMove.amountUsdc, pendingMove.retryMint);
      clearPendingGatewayMove(window.localStorage, owner);
      setPendingMove(null);
      setSent({ amount: pendingMove.amountUsdc, txHash });
      setRecoveryNote(null);
    } catch (err) {
      const recovery = gatewayMoveRecoveryFromError(err);
      const retryAgain = (err as { recoverability?: unknown })?.recoverability === "FATAL"
        ? { state: "submission_unknown" as const }
        : { state: "retry_mint" as const, retryMint: recovery.retryMint ?? pendingMove.retryMint };
      const next = { ...submitting, ...retryAgain };
      savePendingGatewayMove(window.localStorage, next);
      setPendingMove(next);
      setError(walletErrorMessage(err));
    } finally {
      setBusy(null);
      await wallet.returnTo(arcChainId);
      await onDone().catch((err) => console.error("Balance refresh failed after Gateway mint retry:", err));
    }
  }

  async function handleCheckForwarder() {
    if (!pendingMove?.transferId || pendingMove.state !== "forwarder_pending") return;
    setError(null);
    setBusy("Checking the original transfer status…");
    try {
      const status = await getForwarderStatus(pendingMove.transferId, pendingMove.arcChainId);
      if ((status.status === "confirmed" || status.status === "finalized") && status.transactionHash) {
        clearPendingGatewayMove(window.localStorage, owner);
        setPendingMove(null);
        setSent({ amount: pendingMove.amountUsdc, txHash: status.transactionHash });
        setRecoveryNote(null);
      } else if (status.status === "failed" || status.status === "expired") {
        setError(`The original transfer is ${status.status}${status.failureReason ? `: ${status.failureReason}` : ""}. Do not start a new move; contact support with transfer ${pendingMove.transferId}.`);
      } else if (status.status === "confirmed" || status.status === "finalized") {
        setError(`The original transfer is ${status.status}, but Circle did not return a transaction hash. Do not create another move; contact support with transfer ${pendingMove.transferId}.`);
      } else {
        const next = { ...pendingMove, ...(status.expirationBlock ? { expirationBlock: status.expirationBlock } : {}) };
        savePendingGatewayMove(window.localStorage, next);
        setPendingMove(next);
        setRecoveryNote(`Original transfer status: ${status.status}${status.expirationBlock ? `; attestation expires after block ${status.expirationBlock}` : ""}. Check again later; no new transfer was submitted.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the original Gateway transfer.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-card border border-white/10 bg-white/[0.02] p-6">
      <h2 className="text-sm font-medium">2. Move to your wallet on {arc.name}</h2>
      <p className="mt-1 text-xs text-muted">
        From your confirmed Gateway balance. You don&apos;t need gas on {arc.name}: Circle delivers the USDC to your own
        address.
      </p>

      {pendingMove && (
        <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-sm">
          <p className="font-medium">A previous Gateway move needs attention</p>
          <p className="mt-1 text-xs text-muted">
            {recoveryNote ?? (pendingMove.state === "retry_mint"
              ? "The source transfer already committed. Retry only submits its original mint."
              : pendingMove.state === "mint_retry_submitting"
                ? "An original mint retry is in progress or its result is unknown. Do not retry again until you verify the Arc balance or contact support."
              : pendingMove.state === "forwarder_pending"
                ? "The original transfer is being delivered. Check its status; do not create another move."
                : "The result is uncertain. Do not create another move until the original is checked.")}
          </p>
          {pendingMove.state === "retry_mint" && (
            <button type="button" onClick={handleRetryMint} disabled={busy !== null} className="mt-3 rounded-pill bg-gold px-4 py-2 text-xs font-medium text-black disabled:state-disabled disabled:scale-100">
              Retry original delivery
            </button>
          )}
          {pendingMove.state === "forwarder_pending" && (
            <button type="button" onClick={handleCheckForwarder} disabled={busy !== null} className="mt-3 rounded-pill border border-border-input px-4 py-2 text-xs disabled:state-disabled">
              Check original transfer
            </button>
          )}
          {pendingMove.transferId && <p className="mt-2 break-all font-mono text-[10px] text-muted">Transfer: {pendingMove.transferId}</p>}
          <p className="mt-2 break-all font-mono text-[10px] text-muted">Operation: {pendingMove.operationId}</p>
        </div>
      )}
      {depositPending && !pendingMove && (
        <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-xs text-muted">
          A Gateway deposit is still being checked. Resolve it in the deposit panel before starting a move.
        </p>
      )}

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
                disabled={busy !== null || pendingMove !== null || depositPending || !recoveryStorageReady}
                className="mt-1 block w-full rounded-lg border border-border-input bg-surface-1 px-3 py-2 text-sm text-foreground"
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
                disabled={busy !== null || pendingMove !== null}
                className="mt-1 block w-full rounded-lg border border-border-input bg-surface-1 px-3 py-2 text-sm tabular-nums text-foreground"
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
                disabled={busy !== null || pendingMove !== null}
                className="rounded-pill bg-gold px-5 py-2 text-sm font-medium text-black disabled:state-disabled disabled:scale-100"
              >
                Move {review.amount} USDC to {arc.name}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleReview}
                disabled={busy !== null || pendingMove !== null || depositPending || !recoveryStorageReady || amount.trim() === ""}
                className="rounded-pill border border-border-input px-5 py-2 text-sm hover:border-white/30 disabled:state-disabled"
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
