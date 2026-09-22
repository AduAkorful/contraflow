"use client";

/// Party B's link-landing page — plans/21-real-mode-attest-flow.md. Decodes and re-verifies
/// `signatureA` entirely client-side, before rendering any of the terms as trustworthy (plan 14's
/// own explicit ordering) — a mismatch is a full stop, not a warning banner.

import { useEffect, useState } from "react";
import { useAccount, useSignTypedData, useWriteContract, usePublicClient } from "wagmi";
import { recoverTypedDataAddress } from "viem";
import { ConnectButton } from "../../../../components/wallet/ConnectButton";
import { ReviewAndSign } from "../../../../components/attest/ReviewAndSign";
import { decodeAttestLink, type AttestLinkPayload } from "../../../../src/attest/link";
import { invoiceAttestationTypedData } from "../../../../src/attest/signAttestation";
import { contraflowRegistryAbi } from "../../../../src/contracts/abi/index";
import { checkLinkFreshness, requestGrant, preCheck, record } from "../actions";
import { whoAmI } from "../../siwe/actions";

type Phase = "verifying" | "invalid" | "stale" | "ready" | "signing" | "submitting" | "recording" | "done" | "error";

function serializeInvoice(invoice: AttestLinkPayload["invoice"]) {
  return {
    ...invoice,
    amount: invoice.amount.toString(),
    maturity: invoice.maturity.toString(),
    nonce: invoice.nonce.toString(),
    chainId: invoice.chainId.toString(),
  };
}

export function LandingClient({ encoded }: { encoded: string }) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const [phase, setPhase] = useState<Phase>("verifying");
  const [payload, setPayload] = useState<AttestLinkPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [resultTxHash, setResultTxHash] = useState<string | null>(null);

  const partyBRole = payload?.role === "debtor" ? "creditor" : "debtor";

  useEffect(() => {
    (async () => {
      let decoded: AttestLinkPayload;
      try {
        decoded = decodeAttestLink(encoded);
      } catch (err) {
        setError(err instanceof Error ? err.message : "This link is invalid or has been altered.");
        setPhase("invalid");
        return;
      }

      const claimedSignerAddress = decoded.role === "debtor" ? decoded.invoice.debtor : decoded.invoice.creditor;
      let recovered: string;
      try {
        recovered = await recoverTypedDataAddress({
          ...invoiceAttestationTypedData(decoded.invoice),
          signature: decoded.signatureA,
        });
      } catch {
        setError("This link is invalid or has been altered.");
        setPhase("invalid");
        return;
      }
      if (recovered.toLowerCase() !== claimedSignerAddress.toLowerCase()) {
        setError("This link is invalid or has been altered.");
        setPhase("invalid");
        return;
      }

      const freshness = await checkLinkFreshness(decoded.invoice.debtor, decoded.invoice.creditor, decoded.invoice.nonce.toString());
      if (!freshness.ok) {
        setError(freshness.error);
        setPhase("error");
        return;
      }
      if (!freshness.fresh) {
        setError("This invoice is no longer current — it may already be registered, or a newer one exists for this pair.");
        setPhase("stale");
        return;
      }

      setPayload(decoded);
      setPhase("ready");

      const who = await whoAmI();
      if (who.address) setSessionAddress(who.address);
    })();
  }, [encoded]);

  async function handleSignAndRegister() {
    if (!payload || !publicClient) return;
    setError(null);

    try {
      setPhase("signing");
      await requestGrant();

      const typedData = invoiceAttestationTypedData(payload.invoice);
      const signatureB = await signTypedDataAsync(typedData);
      const debtorSignature = payload.role === "debtor" ? payload.signatureA : signatureB;
      const creditorSignature = payload.role === "creditor" ? payload.signatureA : signatureB;

      const preCheckResult = await preCheck(serializeInvoice(payload.invoice), debtorSignature, creditorSignature);
      if (!preCheckResult.ok) {
        setError(preCheckResult.error);
        setPhase("ready");
        return;
      }

      setPhase("submitting");
      const txHash = await writeContractAsync({
        address: payload.invoice.registry,
        abi: contraflowRegistryAbi,
        functionName: "register",
        args: [payload.invoice, debtorSignature, creditorSignature],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setPhase("recording");
      const recordResult = await record(txHash);
      if (!recordResult.ok) {
        // The on-chain register() already succeeded at this point — a record failure means the
        // database write didn't land, not that the invoice registration failed. Reconciliation
        // (plans/19) backfills this the same way it does for the demo's write path.
        console.error("record() failed after a successful register():", recordResult.error);
      }

      setResultTxHash(txHash);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign and register.");
      setPhase("ready");
    }
  }

  if (phase === "verifying") {
    return <p className="text-center text-sm text-muted">Verifying link...</p>;
  }

  if (phase === "invalid" || phase === "stale" || phase === "error") {
    return (
      <div className="animate-error-shake rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  if (phase === "done" && resultTxHash) {
    return (
      <div className="animate-card-entrance rounded-card border border-gold/30 bg-gold/[0.06] p-6 text-center">
        <p className="flex items-center justify-center gap-1.5 text-sm">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true" className="text-gold">
            <path
              d="M3 8.5 L6.5 12 L13 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-check-draw"
              pathLength={32}
            />
          </svg>
          Invoice registered on-chain
        </p>
        <a
          href={`https://explorer.testnet.arc.io/tx/${resultTxHash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs text-gold hover:underline"
        >
          View transaction →
        </a>
      </div>
    );
  }

  if (!payload) return null;

  return (
    <>
      <h1 className="font-serif-display text-3xl leading-[1.05]">Review this invoice</h1>
      <p className="mt-4 text-sm text-muted">
        Signed by your counterparty. Verified against their signature — this is genuinely what they
        signed, not a claim.
      </p>
      <div className="mt-8">
        <ReviewAndSign invoice={payload.invoice} viewerRole={partyBRole}>
          {!isConnected || !sessionAddress ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs text-muted">Connect and sign in to continue.</p>
              <ConnectButton />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handleSignAndRegister}
                disabled={phase === "signing" || phase === "submitting" || phase === "recording"}
                className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:opacity-40"
              >
                {phase === "signing" && "Sign in your wallet..."}
                {phase === "submitting" && "Submitting on-chain..."}
                {phase === "recording" && "Finishing up..."}
                {phase === "ready" && "Sign & register"}
              </button>
              {error && <p className="text-center text-xs text-red-300">{error}</p>}
            </div>
          )}
        </ReviewAndSign>
      </div>
    </>
  );
}
