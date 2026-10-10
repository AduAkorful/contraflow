"use client";

/// Send USDC from the signed-in wallet on Arc. Everything happens in the browser: the wallet signs
/// and pays the fee, and nothing about the recipient or amount reaches Contraflow's servers.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { type Address, type Hex } from "viem";

import { ActionButton, AmountBox, ArrowDivider, ChainBadge } from "@/components/balance/SwapBox";
import { SignerWalletNotice } from "@/components/wallet/SignerWalletNotice";
import { useSignerWallet } from "@/components/wallet/useSignerWallet";
import { prepareWalletContext } from "@/src/attest/walletContext";
import { formatUsdcDisplay } from "@/src/attest/amount";
import { explorerTxUrl } from "@/src/blockscout/explorer";
import { createArcPublicClient } from "@/src/chain/client";
import { addressesForChain } from "@/src/contracts/addresses";
import {
  checkRecipient,
  checkSendAmount,
  clearPendingSend,
  encodeTransfer,
  feeInBaseUnits,
  maxSendable,
  readPendingSend,
  reservedFee,
  savePendingSend,
  SEND_RECOVERY_EVENT,
  transferFailureMessage,
  type PendingSend,
} from "@/src/send/transfer";

const usdcBalanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

interface Review {
  to: Address;
  amount: bigint;
  fee: bigint;
  isContract: boolean;
}

type Stage =
  | { kind: "compose" }
  | { kind: "review"; review: Review }
  | { kind: "sending"; message: string }
  | { kind: "done"; hash: Hex; to: Address; amount: bigint };

/// EIP-7702 delegated accounts keep their own key, so they aren't a contract to warn about.
function hasContractCode(code: Hex | undefined): boolean {
  if (!code || code === "0x") return false;
  return !code.toLowerCase().startsWith("0xef0100");
}

export function SendCard({
  owner,
  chainId,
  chainName,
  initialTo = "",
  onSent,
}: {
  owner: Address;
  chainId: number;
  chainName: string;
  initialTo?: string;
  onSent?: () => Promise<void> | void;
}) {
  const { connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const signerWallet = useSignerWallet(owner);
  const client = useMemo(() => createArcPublicClient(chainId), [chainId]);
  const usdc = addressesForChain(chainId).usdc;

  const [amount, setAmount] = useState("");
  const [to, setTo] = useState(initialTo);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "compose" });
  const [error, setError] = useState<string | null>(null);
  const [acceptContract, setAcceptContract] = useState(false);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);

  const loadBalance = useCallback(async () => {
    try {
      const value = (await client.readContract({ address: usdc, abi: usdcBalanceAbi, functionName: "balanceOf", args: [owner] })) as bigint;
      setBalance(value);
    } catch {
      setBalance(null);
    }
  }, [client, usdc, owner]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    const sync = () => {
      try {
        setPending(readPendingSend(window.localStorage, owner));
        setStorageOk(true);
      } catch {
        setStorageOk(false);
      }
    };
    sync();
    window.addEventListener(SEND_RECOVERY_EVENT, sync);
    return () => window.removeEventListener(SEND_RECOVERY_EVENT, sync);
  }, [owner]);

  // The fee estimate depends only on the transfer shape, so one estimate against a placeholder
  // recipient is enough to size the reserve and Max. The review step re-estimates for the real one.
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const placeholder = "0x000000000000000000000000000000000000dEaD" as Address;
        const [gas, price] = await Promise.all([
          client.estimateGas({ account: owner, to: usdc, data: encodeTransfer(placeholder, 1n) }),
          client.getGasPrice(),
        ]);
        if (current) setFee(feeInBaseUnits(gas, price));
      } catch {
        if (current) setFee(null);
      }
    })();
    return () => {
      current = false;
    };
  }, [client, owner, usdc]);

  const recipient = checkRecipient(to, owner, chainId);
  const maxAmount = balance !== null && fee !== null ? maxSendable(balance, fee) : null;
  const locked = stage.kind === "sending" || pending !== null || !storageOk;

  function edit(update: () => void) {
    update();
    setError(null);
    setAcceptContract(false);
    if (stage.kind === "review") setStage({ kind: "compose" });
  }

  async function handleReview() {
    setError(null);
    if (!recipient.ok) return setError(recipient.error);
    const amountCheck = checkSendAmount(amount, balance, fee);
    if (!amountCheck.ok) return setError(amountCheck.error);
    setStage({ kind: "sending", message: "Checking the network fee…" });
    try {
      const [gas, price, code] = await Promise.all([
        client.estimateGas({ account: owner, to: usdc, data: encodeTransfer(recipient.address, amountCheck.amount) }),
        client.getGasPrice(),
        client.getCode({ address: recipient.address }),
      ]);
      const exactFee = feeInBaseUnits(gas, price);
      if (amountCheck.amount + reservedFee(exactFee) > (balance ?? 0n)) {
        setStage({ kind: "compose" });
        return setError("Leave enough USDC to pay the network fee. Use Max to send the most you can.");
      }
      setFee(exactFee);
      setStage({ kind: "review", review: { to: recipient.address, amount: amountCheck.amount, fee: exactFee, isContract: hasContractCode(code) } });
    } catch (err) {
      setStage({ kind: "compose" });
      setError(transferFailureMessage(err) === "The transfer didn't go through. Check your balance and try again."
        ? "Couldn't check the network fee right now. Nothing was sent."
        : transferFailureMessage(err));
    }
  }

  async function handleSend() {
    if (stage.kind !== "review") return;
    const { review } = stage;
    if (review.isContract && !acceptContract) return;
    setError(null);
    setStage({ kind: "sending", message: "Confirm in your wallet…" });
    let record: PendingSend | null = null;
    try {
      await prepareWalletContext(connector, owner, chainId, async () => switchChainAsync({ chainId }));
      record = { version: 1, owner: owner.toLowerCase(), chainId, to: review.to, amount: review.amount.toString(), createdAt: Date.now() };
      savePendingSend(window.localStorage, record);
      setPending(record);
      const hash = await sendTransactionAsync({ to: usdc, data: encodeTransfer(review.to, review.amount), chainId });
      record = { ...record, txHash: hash };
      savePendingSend(window.localStorage, record);
      setPending(record);
      setStage({ kind: "sending", message: "Sent. Waiting for confirmation…" });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("reverted");
      clearPendingSend(window.localStorage, owner);
      setPending(null);
      setStage({ kind: "done", hash, to: review.to, amount: review.amount });
      setAmount("");
      setTo("");
      void loadBalance();
      void onSent?.();
    } catch (err) {
      const message = transferFailureMessage(err);
      if (record?.txHash) {
        // Submitted but not seen confirmed: keep the record so a second send can't start blindly.
        setError("The transfer was submitted, but we couldn't see it confirm. Check the transaction before sending again.");
      } else {
        // Nothing left the wallet: the record was only a guard.
        try { clearPendingSend(window.localStorage, owner); } catch { /* storage unavailable */ }
        setPending(null);
        setError(message);
      }
      setStage({ kind: "compose" });
    } finally {
      window.dispatchEvent(new Event(SEND_RECOVERY_EVENT));
    }
  }

  async function handleCheckPending() {
    if (!pending) return;
    setNotice(null);
    if (!pending.txHash) {
      setNotice("This send never reached your wallet's network. It's safe to clear.");
      return;
    }
    try {
      const receipt = await client.getTransactionReceipt({ hash: pending.txHash });
      clearPendingSend(window.localStorage, owner);
      setPending(null);
      setNotice(receipt.status === "success" ? "That transfer confirmed." : "That transfer failed onchain. Nothing was sent.");
      void loadBalance();
    } catch {
      setNotice("That transaction isn't confirmed yet. Check again in a moment.");
    }
  }

  function clearPending() {
    try { clearPendingSend(window.localStorage, owner); } catch { /* ignore */ }
    setPending(null);
    setNotice(null);
  }

  const amountCheck = checkSendAmount(amount, balance, fee);
  const canReview = amount.trim() !== "" && recipient.ok && amountCheck.ok;
  const buttonLabel =
    amount.trim() === "" ? "Enter an amount" : to.trim() === "" ? "Enter a recipient" : !recipient.ok ? "Check the recipient" : !amountCheck.ok ? "Check the amount" : "Review send";

  return (
    <div>
      <p className="mb-4 text-xs text-muted">
        Send USDC from your wallet on {chainName} to any address. Your wallet signs and pays the network fee. Transfers
        can&apos;t be undone.
      </p>

      {pending && (
        <div className="mb-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-sm">
          <p className="font-medium">A previous send needs checking</p>
          <p className="mt-1 text-xs text-muted">
            {formatUsdcDisplay(BigInt(pending.amount))} USDC to <span className="font-mono">{pending.to}</span>. Check it before sending again.
          </p>
          {pending.txHash && explorerTxUrl(chainId, pending.txHash) && (
            <a href={explorerTxUrl(chainId, pending.txHash)!} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-gold hover:underline">
              View the transaction →
            </a>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={handleCheckPending} className="rounded-pill border border-border-input px-4 py-2 text-xs">
              Check status
            </button>
            {!pending.txHash && (
              <button type="button" onClick={clearPending} className="rounded-pill border border-border-input px-4 py-2 text-xs">
                Clear
              </button>
            )}
          </div>
        </div>
      )}
      {notice && <p className="mb-3 rounded-2xl border border-border-subtle px-4 py-3 text-xs text-muted" role="status">{notice}</p>}
      {!storageOk && (
        <p className="mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
          This browser can&apos;t keep the safety record sends need, so sending is disabled.
        </p>
      )}

      {stage.kind === "done" ? (
        <div className="rounded-[20px] border border-border-subtle bg-surface-2/40 p-5 text-center">
          <p className="text-sm font-medium text-cleared">Sent</p>
          <p className="mt-2 text-2xl tabular-nums">{formatUsdcDisplay(stage.amount)} USDC</p>
          <p className="mt-2 text-xs text-muted">to <span className="font-mono">{stage.to}</span></p>
          {explorerTxUrl(chainId, stage.hash) && (
            <a href={explorerTxUrl(chainId, stage.hash)!} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-gold hover:underline">
              View the transaction →
            </a>
          )}
          <button type="button" onClick={() => setStage({ kind: "compose" })} className="mt-4 block w-full rounded-[20px] border border-border-input py-3 text-sm hover:border-white/30">
            Send another
          </button>
        </div>
      ) : (
        <>
          <AmountBox
            label="You send"
            value={amount}
            onChange={(value) => edit(() => setAmount(value))}
            disabled={locked}
            selector={
              <span className="inline-flex shrink-0 items-center gap-2 rounded-pill border border-border-input bg-surface-1 py-1.5 pl-2 pr-4 text-sm font-medium">
                <ChainBadge name="USDC" />
                USDC
              </span>
            }
            balance={<>Balance: {balance === null ? "…" : `${formatUsdcDisplay(balance)} USDC`}</>}
            onMax={maxAmount !== null && maxAmount > 0n ? () => edit(() => setAmount(formatUsdcDisplay(maxAmount))) : undefined}
          />
          <ArrowDivider />
          <div className="rounded-[20px] border border-border-subtle bg-surface-2/40 p-5">
            <label htmlFor="send-to" className="text-xs text-muted">To address</label>
            <input
              id="send-to"
              value={to}
              onChange={(event) => edit(() => setTo(event.target.value))}
              disabled={locked}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full bg-transparent font-mono text-sm text-foreground placeholder:text-muted/50 focus:outline-none"
            />
            {to.trim() !== "" && !recipient.ok && <p className="mt-2 text-xs text-red-300">{recipient.error}</p>}
            {recipient.ok && <p className="mt-2 text-xs text-muted">Check the whole address. A transfer can&apos;t be undone.</p>}
          </div>

          {stage.kind === "review" && (
            <div className="mt-4 rounded-[20px] border border-border-subtle px-4 py-4 text-sm">
              <p className="text-xs text-muted">You are sending</p>
              <p className="mt-1 text-xl tabular-nums">{formatUsdcDisplay(stage.review.amount)} USDC</p>
              <p className="mt-3 text-xs text-muted">To</p>
              <p className="mt-1 break-all font-mono text-xs">{stage.review.to}</p>
              <p className="mt-3 text-xs text-muted">
                Network fee: about {formatUsdcDisplay(stage.review.fee)} USDC, paid from your wallet.
              </p>
              {stage.review.isContract && (
                <label className="mt-3 flex items-start gap-2 text-xs text-amber-300">
                  <input type="checkbox" checked={acceptContract} onChange={(e) => setAcceptContract(e.target.checked)} className="mt-0.5" />
                  This address is a contract. Only send USDC to it if you know it accepts it.
                </label>
              )}
            </div>
          )}

          {error && <p role="alert" className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
          {stage.kind === "sending" && <p className="mt-4 text-sm text-muted" aria-live="polite">{stage.message}</p>}
          <div className="mt-3"><SignerWalletNotice wallet={signerWallet} signerAddress={owner} /></div>

          {stage.kind === "review" ? (
            <ActionButton
              onClick={handleSend}
              disabled={locked || signerWallet.state !== "ready" || (stage.review.isContract && !acceptContract)}
            >
              Send {formatUsdcDisplay(stage.review.amount)} USDC
            </ActionButton>
          ) : (
            <ActionButton onClick={handleReview} disabled={locked || !canReview || signerWallet.state !== "ready"}>
              {buttonLabel}
            </ActionButton>
          )}
        </>
      )}
    </div>
  );
}
