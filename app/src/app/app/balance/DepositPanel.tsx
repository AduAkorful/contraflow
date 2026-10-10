"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { deposit, estimateDeposit, isUnsupportedSmartAccount, readGatewayBalances, walletCode, walletUsdc } from "@/src/kits/browserAdapter";
import { checkUsdcAmount, feeLabel, fromBaseUnits, parseGatewayBalances, toBaseUnits, type FeeLine } from "@/src/kits/gatewayBalance";
import { explorerTxLink, gatewaySourceChains, networkTypeForChainId, type GatewayChain } from "@/src/kits/gatewayChains";
import { roundDecimalString } from "@/src/kits/quoteFormat";
import { ActionButton, AmountBox, ArrowDivider, ChainPill, ChainSelect, ReceiveBox } from "@/components/balance/SwapBox";
import { walletErrorMessage, type WalletState } from "./wallet";
import { prepareWalletContext } from "@/src/attest/walletContext";
import { clearPendingGatewayDeposit, GATEWAY_RECOVERY_EVENT, gatewayTxHashFromError, readPendingGatewayDeposit, readPendingGatewayMove, savePendingGatewayDeposit, type PendingGatewayDeposit } from "@/src/kits/gatewayRecovery";

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
  const { connector } = useAccount();
  const chains = gatewaySourceChains(arcChainId);
  const [chainName, setChainName] = useState(chains[0]?.chain ?? "");
  const [amount, setAmount] = useState("");
  const [held, setHeld] = useState<bigint | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ chain: GatewayChain; amount: string; txHash: string } | null>(null);
  const [heldVersion, setHeldVersion] = useState(0);
  const [pendingDeposit, setPendingDeposit] = useState<PendingGatewayDeposit | null>(null);
  const [recoveryNote, setRecoveryNote] = useState<string | null>(null);
  const [recoveryStorageReady, setRecoveryStorageReady] = useState(false);
  const [movePending, setMovePending] = useState(false);

  useEffect(() => {
    const sync = () => {
      try {
        setPendingDeposit(readPendingGatewayDeposit(window.localStorage, owner));
        setMovePending(readPendingGatewayMove(window.localStorage, owner) !== null);
        setRecoveryStorageReady(true);
      } catch {
        setRecoveryStorageReady(false);
        setError("This browser cannot read Gateway recovery state. Deposits are disabled until local storage is available.");
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

  const chain = chains.find((c) => c.chain === chainName);
  const pendingDepositChain = pendingDeposit ? chains.find((c) => c.chain === pendingDeposit.sourceChain) : undefined;

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
    if (!recoveryStorageReady) return setError("This browser cannot verify Gateway recovery storage yet. Try again in a moment.");
    if (pendingDeposit || movePending) return setError("Resolve the previous Gateway operation before submitting another one.");
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
    if (!review || pendingDeposit || movePending || !recoveryStorageReady) return;
    setError(null);
    setBusy("Confirm in your wallet: you may be asked to sign an authorization, then to send the deposit.");
    try {
      await wallet.switchTo(review.chain);
      await prepareWalletContext(connector, owner, review.chain.chainId, async () => wallet.switchTo(review!.chain));
      const rawBefore = await readGatewayBalances(owner, networkTypeForChainId(arcChainId));
      const parsedBefore = parseGatewayBalances(rawBefore, arcChainId);
      const sourceBalance = parsedBefore.rows.find((row) => row.chain === review.chain.chain)?.confirmed ?? "0";
      const operation: PendingGatewayDeposit = {
        version: 1,
        operationId: crypto.randomUUID(),
        owner: owner.toLowerCase() as `0x${string}`,
        sourceChain: review.chain.chain,
        amountUsdc: review.amount,
        baselineConfirmedUsdc: sourceBalance,
        state: "submission_unknown",
        createdAt: Date.now(),
      };
      savePendingGatewayDeposit(window.localStorage, operation);
      setPendingDeposit(operation);
      const { txHash } = await deposit(await wallet.adapter(), review.chain, review.amount);
      clearPendingGatewayDeposit(window.localStorage, owner);
      setPendingDeposit(null);
      setSent({ chain: review.chain, amount: review.amount, txHash });
      setReview(null);
      setAmount("");
    } catch (err) {
      console.error("deposit failed:", err);
      let operation: PendingGatewayDeposit | null = null;
      try {
        operation = readPendingGatewayDeposit(window.localStorage, owner);
      } catch {
        setError("The deposit result is uncertain and this browser cannot read recovery state. Do not submit another deposit.");
        return;
      }
      if (operation) {
        const txHash = gatewayTxHashFromError(err);
        const next = txHash ? { ...operation, txHash } : operation;
        try { savePendingGatewayDeposit(window.localStorage, next); } catch { /* existing pre-send record remains */ }
        setPendingDeposit(next);
        setError("The deposit result is uncertain. Check Gateway status before you try again; submitting again could deposit twice.");
      } else {
        setError(walletErrorMessage(err));
      }
    } finally {
      setBusy(null);
      await wallet.returnTo(arcChainId);
      setHeldVersion((v) => v + 1);
      await onDone().catch((err) => console.error("Balance refresh failed after Gateway deposit:", err));
    }
  }

  async function handleCheckDeposit() {
    if (!pendingDeposit) return;
    setError(null);
    setBusy("Checking the original deposit…");
    try {
      const raw = await readGatewayBalances(owner, networkTypeForChainId(arcChainId));
      const view = parseGatewayBalances(raw, arcChainId);
      const current = view.rows.find((row) => row.chain === pendingDeposit.sourceChain)?.confirmed ?? "0";
      const target = toBaseUnits(pendingDeposit.baselineConfirmedUsdc) + toBaseUnits(pendingDeposit.amountUsdc);
      if (toBaseUnits(current) >= target) {
        clearPendingGatewayDeposit(window.localStorage, owner);
        setPendingDeposit(null);
        setRecoveryNote(`Gateway now shows the expected balance increase on ${pendingDeposit.sourceChain}. You can review a move to Arc.`);
        setHeldVersion((v) => v + 1);
      } else {
        setRecoveryNote(`The original deposit is not confirmed yet (${current} USDC confirmed on ${pendingDeposit.sourceChain}). Check again later; no new deposit was submitted.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the original Gateway deposit status.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="mb-4 text-xs text-muted">Deposit from your wallet on another chain. Your wallet pays that chain&apos;s network fee.</p>

      {(pendingDeposit || recoveryNote) && (
        <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-sm">
          <p className="font-medium">{pendingDeposit ? "A previous deposit needs confirmation" : "Deposit status checked"}</p>
          <p className="mt-1 text-xs text-muted">
            {recoveryNote ?? `The result of the ${pendingDeposit?.amountUsdc} USDC deposit is uncertain. Check the original balance increase; do not submit another deposit.`}
          </p>
          {pendingDeposit?.txHash && pendingDepositChain && (
            <a href={explorerTxLink(pendingDepositChain, pendingDeposit.txHash)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-gold hover:underline">
              View original transaction →
            </a>
          )}
          {pendingDeposit && <p className="mt-2 break-all font-mono text-xs text-muted">Operation: {pendingDeposit.operationId}</p>}
          {pendingDeposit && (
            <button type="button" onClick={handleCheckDeposit} disabled={busy !== null} className="mt-3 rounded-pill border border-border-input px-4 py-2 text-xs disabled:state-disabled">
              Check original deposit
            </button>
          )}
        </div>
      )}
      {movePending && !pendingDeposit && (
        <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-xs text-muted">
          A Gateway move is still being checked. Resolve it in the move panel before starting a deposit.
        </p>
      )}

      <AmountBox
        label="From"
        value={amount}
        onChange={(value) => edit(() => setAmount(value))}
        disabled={busy !== null || pendingDeposit !== null || movePending || !recoveryStorageReady}
        selector={
          <ChainSelect
            value={chainName}
            onChange={(value) => edit(() => setChainName(value))}
            disabled={busy !== null || pendingDeposit !== null || movePending || !recoveryStorageReady}
            options={chains.map((c) => ({ value: c.chain, label: c.name }))}
            label="Source chain"
          />
        }
        balance={<>Balance: {held === null ? "…" : `${roundDecimalString(fromBaseUnits(held), 2)} USDC`}</>}
        onMax={held !== null && held > 0n ? () => edit(() => setAmount(fromBaseUnits(held))) : undefined}
      />
      <ArrowDivider />
      <ReceiveBox
        label="To your Gateway balance"
        amount={amount.trim()}
        target={<ChainPill name="Circle Gateway" mark>Circle Gateway</ChainPill>}
        note="Held by Circle until you move it to Arc."
      />

      {review && (
        <div className="mt-4 rounded-2xl border border-border-subtle px-4 py-3 text-sm">
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

      {review ? (
        <ActionButton onClick={handleDeposit} disabled={busy !== null || pendingDeposit !== null}>
          Deposit {review.amount} USDC
        </ActionButton>
      ) : (
        <ActionButton
          onClick={handleReview}
          disabled={busy !== null || pendingDeposit !== null || movePending || !recoveryStorageReady || amount.trim() === ""}
        >
          {amount.trim() === "" ? "Enter an amount" : "Review deposit"}
        </ActionButton>
      )}
    </div>
  );
}
