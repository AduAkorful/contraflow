"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, ContractFunctionRevertedError, type Address, type Hex } from "viem";
import { Money } from "../ui/Money";
import { prepareWalletContext } from "../../src/attest/walletContext";
import { prepareToSubmit } from "../../src/attest/submitAsParty";
import { starterGrantToast } from "../../src/attest/grantCopy";
import { contraflowSettlerAbi } from "../../src/contracts/abi/index";
import { findSettleableLoop, recordSettlement, type FindSettleableLoopResult, type InvoiceLoopView } from "../../src/app/app/settle/actions";
import { settleLoopSentence } from "../../src/settle/copy";

type Phase = "loading" | "none" | "incomplete" | "loop" | "settling" | "pending" | "reverted" | "done";

export function SettleLoopCard({
  sessionAddress,
  onLoopIds,
  embedded = false,
}: {
  sessionAddress: string;
  onLoopIds?: (ids: string[]) => void;
  embedded?: boolean;
}) {
  const router = useRouter();
  const { connector } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loop, setLoop] = useState<InvoiceLoopView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [grantNote, setGrantNote] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function refresh() {
    let result: FindSettleableLoopResult;
    try {
      result = await findSettleableLoop();
    } catch (err) {
      console.error("Loop check failed:", err);
      result = { kind: "error", error: "Couldn't check for loops right now." };
    }
    applyResult(result);
  }

  function applyResult(result: FindSettleableLoopResult) {
    if (result.kind === "error") {
      setPhase("incomplete");
      setError(result.error);
      onLoopIds?.([]);
      return;
    }
    if (result.kind === "none") {
      setPhase("none");
      setLoop(null);
      setError(null);
      onLoopIds?.([]);
      return;
    }
    if (result.kind === "incomplete") {
      setPhase("incomplete");
      setLoop(null);
      setError(null);
      onLoopIds?.([]);
      return;
    }
    setLoop(result);
    setPhase("loop");
    setError(null);
    onLoopIds?.(result.invoiceIds);
  }

  useEffect(() => {
    void refresh();
    // One check on mount; Settle retriggers refresh after a stale simulation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function settle() {
    if (!loop || !publicClient || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    let submittedHash: `0x${string}` | null = null;
    let writeAttempted = false;
    try {
      setPhase("settling");
      const me = sessionAddress as Address;
      const grant = await prepareToSubmit(connector, me, loop.chainId, switchChainAsync);
      if (grant.ok && !grant.alreadyGranted && grant.amountUsdc) setGrantNote(starterGrantToast(grant.amountUsdc, loop.chainId));

      const wNet = BigInt(loop.wNet);
      const invoiceIds = loop.invoiceIds as Hex[];
      try {
        await publicClient.simulateContract({
          address: loop.settler,
          abi: contraflowSettlerAbi,
          functionName: "settle",
          args: [invoiceIds, wNet],
          account: me,
        });
      } catch (err) {
        if (!isContractRevert(err)) throw new Error("Couldn't reach Arc to check this settlement. Nothing was submitted. Try again.");
        setError("This loop changed. Refresh to see the current one.");
        inFlight.current = false;
        await refresh();
        return;
      }

      await prepareWalletContext(connector, me, loop.chainId, switchChainAsync);
      writeAttempted = true;
      const hash = await writeContractAsync({
        address: loop.settler,
        abi: contraflowSettlerAbi,
        functionName: "settle",
        args: [invoiceIds, wNet],
      });
      submittedHash = hash;
      setTxHash(hash);

      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({ hash });
      } catch {
        setError("The transaction was submitted, but Arc has not confirmed its status yet. Check the transaction before trying again.");
        setPhase("pending");
        return;
      }
      if (receipt.status !== "success") {
        setError("Arc confirmed that this settlement reverted. Nothing was netted.");
        setPhase("reverted");
        return;
      }

      await recordSettlement(hash);
      router.push(`/app/receipt/${hash}`);
      setPhase("done");
    } catch (err) {
      if (submittedHash) {
        setError("The transaction was submitted, but follow-up confirmation failed. Check its status before trying again.");
        setPhase("pending");
      } else if ((err as { code?: unknown })?.code === 4001) {
        setError("You cancelled in your wallet. Nothing was submitted.");
        setPhase("loop");
      } else if (writeAttempted) {
        setError("Your wallet did not return a transaction hash. Check Arc for a pending settlement before trying again.");
        setPhase("pending");
      } else {
        setError(err instanceof Error ? err.message : "Failed to settle.");
        setPhase("loop");
      }
    } finally {
      inFlight.current = false;
    }
  }

  function Frame({ children, highlight = false }: { children: ReactNode; highlight?: boolean }) {
    if (embedded) return <div className="px-5 py-4">{children}</div>;
    return (
      <section className={`rounded-card border px-5 py-4 ${highlight ? "border-gold/30 bg-gold/[0.06]" : "border-border-subtle bg-surface-1"}`}>
        <h2 className="text-sm font-semibold">Ready to net</h2>
        {children}
      </section>
    );
  }

  if (phase === "loading") {
    return (
      <Frame>
        <p className={embedded ? "text-sm text-muted" : "mt-2 text-sm text-muted"}>Checking for loops…</p>
      </Frame>
    );
  }

  if (phase === "none") {
    return (
      <Frame>
        <p className={embedded ? "text-sm text-muted" : "mt-2 text-sm text-muted"}>No loop to net yet</p>
      </Frame>
    );
  }

  if (phase === "incomplete" && !loop) {
    return (
      <Frame>
        <p className={embedded ? "text-sm text-muted" : "mt-2 text-sm text-muted"}>{error ?? "Couldn't check for loops right now"}</p>
      </Frame>
    );
  }

  if (phase === "pending" || phase === "reverted") {
    return (
      <Frame>
        <p className={embedded ? "text-sm font-medium" : "mt-2 text-sm font-medium"}>
          {phase === "pending" ? "Settlement status needs checking" : "Settlement reverted"}
        </p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {txHash && (
          <a href={`/app/receipt/${txHash}`} className="mt-3 inline-block text-sm text-gold hover:underline">
            Open transaction →
          </a>
        )}
      </Frame>
    );
  }

  if (!loop) return null;

  return (
    <Frame highlight>
      <p className={embedded ? "text-sm text-muted" : "mt-2 text-sm text-muted"}>{settleLoopSentence(loop.invoiceIds.length, loop.wNet)}</p>
      <p className="mt-2 text-xs text-muted">
        Anyone in the loop can settle. Network fee about <Money value="0.004" />, paid from your account.
      </p>
      <button
        type="button"
        onClick={() => void settle()}
        disabled={phase === "settling"}
        className="mt-4 rounded-pill bg-gold px-5 py-2 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
      >
        {phase === "settling" ? "Settling…" : "Settle"}
      </button>
      {grantNote && <p className="mt-3 text-xs text-muted">{grantNote}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Frame>
  );
}

function isContractRevert(err: unknown): boolean {
  return err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError;
}
