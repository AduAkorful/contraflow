"use client";

/// Party B's link-landing page. Decodes and re-verifies `signatureA` entirely client-side,
/// before rendering any of the terms as trustworthy — a mismatch is a full stop, not a warning
/// banner.

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useSwitchChain } from "wagmi";
import { recoverTypedDataAddress, hashTypedData, type Address } from "viem";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { useContraflowSignTypedData } from "@/components/wallet/useContraflowSignTypedData";
import { SessionBound, useSession } from "@/components/session/SessionProvider";
import { ReviewAndSign } from "@/components/attest/ReviewAndSign";
import { RegisterProgress } from "@/components/attest/RegisterProgress";
import { Money } from "@/components/ui/Money";
import { invoiceSigningConfirmation } from "@/src/format/signing";
import { signingInLabel } from "@/src/session/signInCopy";
import { isEmbeddedWalletClient } from "@/src/session/signingWallet";
import { useWallets } from "@privy-io/react-auth";
import { formatUsdcAmount } from "@/src/attest/amount";
import { decodeAttestLink, parseAttestLinkObject, type AttestLinkPayload } from "@/src/attest/link";
import { hashInvoiceDocument, type CanonicalInvoiceDocument } from "@/src/attest/document";
import { invoiceAttestationTypedData } from "@/src/attest/signAttestation";
import { invoiceViewerRole, isInvoiceCounterparty } from "@/src/attest/viewer";
import { prepareWalletContext } from "@/src/attest/walletContext";
import { starterGrantToast } from "@/src/attest/grantCopy";
import { ARC_TESTNET_CHAIN_ID } from "@/src/contracts/addresses";
import { contraflowRegistryAbi } from "@/src/contracts/abi/index";
import { arcTestnet } from "@/src/chain/client";
import { checkLinkFreshness, getInvoiceDocument, getInvoiceLink, requestGrant, preCheck, record } from "../actions";

type Phase = "verifying" | "sign-in-required" | "invalid" | "stale" | "ready" | "signing" | "submitting" | "recording" | "pending" | "reverted" | "done" | "error";
const ARC_EXPLORER = arcTestnet.blockExplorers?.default.url;

function serializeInvoice(invoice: AttestLinkPayload["invoice"]) {
  return {
    ...invoice,
    amount: invoice.amount.toString(),
    maturity: invoice.maturity.toString(),
    nonce: invoice.nonce.toString(),
    chainId: invoice.chainId.toString(),
  };
}

export function LandingClient({ encoded, token }: { encoded?: string; token?: string }) {
  const { address, connector } = useAccount();
  const { signTypedData } = useContraflowSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { address: sessionAddress } = useSession();
  const { wallets } = useWallets();
  const signingKind = isEmbeddedWalletClient(wallets.find((w) => w.address.toLowerCase() === address?.toLowerCase())?.walletClientType)
    ? "embedded"
    : "external";

  const [phase, setPhase] = useState<Phase>("verifying");
  const [payload, setPayload] = useState<AttestLinkPayload | null>(null);
  const [document, setDocument] = useState<CanonicalInvoiceDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultTxHash, setResultTxHash] = useState<string | null>(null);
  const [recordWarning, setRecordWarning] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [grantNote, setGrantNote] = useState<string | null>(null);
  const registryId = payload ? hashTypedData(invoiceAttestationTypedData(payload.invoice)) : null;

  const viewerRole = payload ? invoiceViewerRole(payload.invoice, sessionAddress) : null;
  const mayCoSign = payload ? isInvoiceCounterparty(payload.invoice, payload.role, sessionAddress, address) : false;

  async function verifyTerms(decoded: AttestLinkPayload, terms: CanonicalInvoiceDocument) {
    // Always compare the canonical document before recovering or trusting either signature.
    let documentHash: string;
    try {
      documentHash = hashInvoiceDocument(terms);
    } catch {
      setError("This link is invalid or has been altered.");
      setPhase("invalid");
      return;
    }
    if (documentHash !== decoded.invoice.invoiceRef) {
      setError("This link is invalid or has been altered.");
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

    setDocument(terms);
    setPhase("ready");
  }

  async function loadPrivateTerms(decoded: AttestLinkPayload, signedInAddress: string) {
    if (decoded.version !== 2) return;
    const isParty = [decoded.invoice.debtor, decoded.invoice.creditor].some(
      (party) => party.toLowerCase() === signedInAddress.toLowerCase(),
    );
    if (!isParty) {
      setError("This invoice link isn't available to the signed-in wallet.");
      setPhase("invalid");
      return;
    }

    setPhase("verifying");
    let result: Awaited<ReturnType<typeof getInvoiceDocument>>;
    try {
      result = await getInvoiceDocument(decoded.invoice.invoiceRef);
    } catch {
      setError("Invoice details couldn't be loaded. Try again in a moment.");
      setPhase("error");
      return;
    }
    if (!result.ok) {
      if (result.error === "Sign in first.") {
        setPhase("sign-in-required");
        return;
      }
      setError("This invoice link isn't available to the signed-in wallet.");
      setPhase("invalid");
      return;
    }
    await verifyTerms(decoded, result.document);
    setLoadedFor(signedInAddress);
  }

  useEffect(() => {
    if (token) return;
    if (!encoded) {
      setError("This link is invalid or has been altered.");
      setPhase("invalid");
      return;
    }
    (async () => {
      let decoded: AttestLinkPayload;
      try {
        decoded = decodeAttestLink(encoded);
      } catch (err) {
        setError(err instanceof Error ? err.message : "This link is invalid or has been altered.");
        setPhase("invalid");
        return;
      }
      setPayload(decoded);
      if (decoded.version === 1) {
        await verifyTerms(decoded, decoded.document);
      }
    })();
  }, [encoded, token]);

  useEffect(() => {
    if (!token) return;
    if (!sessionAddress) {
      setPayload(null);
      setDocument(null);
      setLoadedFor(null);
      setPhase("sign-in-required");
      return;
    }
    (async () => {
      setPhase("verifying");
      const result = await getInvoiceLink(token);
      if (!result.ok) {
        if (result.error === "Sign in first.") {
          setPhase("sign-in-required");
          return;
        }
        setError(result.error);
        setPhase(result.error === "Not found." ? "invalid" : "error");
        return;
      }
      let decoded: AttestLinkPayload;
      try {
        decoded = parseAttestLinkObject(result.payload);
      } catch {
        setError("This link is invalid or has been altered.");
        setPhase("invalid");
        return;
      }
      setPayload(decoded);
      setLoadedFor(sessionAddress);
      await loadPrivateTerms(decoded, sessionAddress);
    })();
  }, [token, sessionAddress]);

  useEffect(() => {
    if (token) return;
    if (!payload || payload.version !== 2) return;
    if (!sessionAddress) {
      setDocument(null);
      setLoadedFor(null);
      setPhase("sign-in-required");
      return;
    }
    void loadPrivateTerms(payload, sessionAddress);
  }, [payload, sessionAddress, token]);

  async function handleSignAndRegister() {
    if (!payload || !publicClient) return;
    setError(null);
    setRecordWarning(null);
    let submittedHash: `0x${string}` | null = null;
    let writeAttempted = false;

    try {
      setPhase("signing");
      const grant = await requestGrant();
      if (grant.ok && !grant.alreadyGranted && grant.amountUsdc) {
        setGrantNote(starterGrantToast(grant.amountUsdc, ARC_TESTNET_CHAIN_ID));
      }

      const expectedSigner = (payload.role === "debtor" ? payload.invoice.creditor : payload.invoice.debtor) as Address;
      await prepareWalletContext(connector, expectedSigner, ARC_TESTNET_CHAIN_ID, switchChainAsync);

      const typedData = invoiceAttestationTypedData(payload.invoice);
      const signatureB = await signTypedData(typedData, {
        title: "Confirm this invoice",
        description: invoiceSigningConfirmation({
          youOwe: payload.role !== "debtor",
          amountUsdc: payload.invoice.amount,
          counterparty: payload.role === "debtor" ? payload.invoice.debtor : payload.invoice.creditor,
          maturity: payload.invoice.maturity,
          earlyNetConsent: payload.invoice.earlyNetConsent,
        }),
      });
      await prepareWalletContext(connector, expectedSigner, ARC_TESTNET_CHAIN_ID, switchChainAsync);
      const debtorSignature = payload.role === "debtor" ? payload.signatureA : signatureB;
      const creditorSignature = payload.role === "creditor" ? payload.signatureA : signatureB;

      const preCheckResult = await preCheck(serializeInvoice(payload.invoice), debtorSignature, creditorSignature);
      if (!preCheckResult.ok) {
        setError(preCheckResult.error);
        setPhase("ready");
        return;
      }

      setPhase("submitting");
      await prepareWalletContext(connector, expectedSigner, ARC_TESTNET_CHAIN_ID, switchChainAsync);
      writeAttempted = true;
      const txHash = await writeContractAsync({
        address: payload.invoice.registry,
        abi: contraflowRegistryAbi,
        functionName: "register",
        args: [payload.invoice, debtorSignature, creditorSignature],
      });
      submittedHash = txHash;
      setResultTxHash(txHash);

      setPhase("recording");
      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      } catch {
        setError("The transaction was submitted, but Arc has not confirmed its status yet. Check the transaction before trying again.");
        setPhase("pending");
        return;
      }
      if (receipt.status !== "success") {
        setError("Arc confirmed that this registration reverted. No invoice was registered.");
        setPhase("reverted");
        return;
      }

      setPhase("done");
      try {
        const recordResult = await record(txHash);
        if (!recordResult.ok) {
          setRecordWarning("Arc confirmed the registration, but history has not synced yet. Contraflow will reconcile it automatically.");
          console.error("record() failed after a successful register():", recordResult.error);
        }
      } catch (recordError) {
        setRecordWarning("Arc confirmed the registration, but history has not synced yet. Contraflow will reconcile it automatically.");
        console.error("record() threw after a successful register():", recordError);
      }
    } catch (err) {
      if (submittedHash) {
        setError("The transaction was submitted, but follow-up confirmation failed. Check its status before trying again.");
        setPhase("pending");
      } else if ((err as { code?: unknown })?.code === 4001) {
        setError("You cancelled in your wallet. Nothing was submitted.");
        setPhase("ready");
      } else if (writeAttempted) {
        setError("Your wallet did not return a transaction hash. Check Arc for a pending registration before trying again.");
        setPhase("pending");
      } else {
        setError(err instanceof Error ? err.message : "Failed to sign and register.");
        setPhase("ready");
      }
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

  if (phase === "sign-in-required") {
    return (
      <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
        <h1 className="heading-1">Sign in</h1>
        <p className="mt-3 text-sm text-muted">This link is for a specific account.</p>
        <div className="mt-6">
          <ConnectButton />
        </div>
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
          Invoice registered on Arc
        </p>
        <div className="mt-4">
          <RegisterProgress step={3} txHash={resultTxHash} explorerBase={ARC_EXPLORER} />
        </div>
        {grantNote && <p className="mt-3 text-xs text-muted">{grantNote}</p>}
        <p className="mt-3 text-xs text-muted">
          {payload ? <Money value={formatUsdcAmount(payload.invoice.amount)} className="text-foreground" /> : "This invoice"} is now registered.
          If it forms a loop with other invoices, you'll see a Settle button on your Overview.
        </p>
        {registryId && (
          <p className="mt-3 text-xs text-faint">
            Invoice ID <span className="break-all font-mono text-muted">{registryId}</span>
          </p>
        )}
        {payload?.invoice.invoiceRef && (
          <p className="mt-1 text-xs text-faint">
            Document hash <span className="break-all font-mono text-muted">{payload.invoice.invoiceRef}</span>
          </p>
        )}
        {recordWarning && <p className="mt-3 text-xs text-muted">{recordWarning}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
          {sessionAddress && (
            <a href={`/app/history?address=${sessionAddress}`} className="text-gold hover:underline">
              See it in your history →
            </a>
          )}
          {ARC_EXPLORER && (
            <a href={`${ARC_EXPLORER}/tx/${resultTxHash}`} target="_blank" rel="noreferrer" className="text-muted hover:underline">
              View transaction →
            </a>
          )}
          <a href="/app/attest" className="text-muted hover:underline">
            Send another invoice →
          </a>
        </div>
      </div>
    );
  }

  if ((phase === "pending" || phase === "reverted") ) {
    return (
      <div className="animate-card-entrance rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm font-medium">{phase === "pending" ? "Registration status needs checking" : "Registration reverted"}</p>
        <p className="mt-2 text-sm text-muted">{error}</p>
        {resultTxHash && ARC_EXPLORER && (
          <a href={`${ARC_EXPLORER}/tx/${resultTxHash}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-xs text-gold hover:underline">
            Check transaction on Arc →
          </a>
        )}
      </div>
    );
  }

  if (!payload) return null;

  const review = (
    <>
      <h1 className="heading-1">Review this invoice</h1>
      <p className="mt-4 text-sm text-muted">
        Signed by your counterparty. Verified against their signature — this is genuinely what they
        signed, not a claim.
      </p>
      <div className="mt-8">
        <ReviewAndSign invoice={payload.invoice} viewerRole={viewerRole} description={document?.description}>
          {!sessionAddress ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs text-muted">Sign in to continue.</p>
              <ConnectButton />
            </div>
          ) : !mayCoSign ? (
            <p className="text-center text-xs text-muted">
              {viewerRole === null
                ? "This invoice link is not addressed to the wallet signed in here."
                : "This wallet signed this invoice already; only the other party can co-sign it."}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <p className="max-w-sm text-center text-xs text-muted">
                {invoiceSigningConfirmation({
                  youOwe: viewerRole === "debtor",
                  amountUsdc: payload.invoice.amount,
                  counterparty: viewerRole === "debtor" ? payload.invoice.creditor : payload.invoice.debtor,
                  maturity: payload.invoice.maturity,
                  earlyNetConsent: payload.invoice.earlyNetConsent,
                })}
              </p>
              <button
                onClick={handleSignAndRegister}
                disabled={phase === "signing" || phase === "submitting" || phase === "recording"}
                className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
              >
                {phase === "signing" && signingInLabel(signingKind)}
                {phase === "submitting" && "Submitting to Arc..."}
                {phase === "recording" && "Finishing up..."}
                {phase === "ready" && "Sign & register"}
              </button>
              {(phase === "signing" || phase === "submitting" || phase === "recording") && (
                <RegisterProgress
                  step={phase === "signing" ? 1 : phase === "submitting" ? 2 : 3}
                  txHash={resultTxHash}
                  explorerBase={ARC_EXPLORER}
                />
              )}
              {grantNote && <p className="text-center text-xs text-muted">{grantNote}</p>}
              {error && <p className="text-center text-xs text-red-300">{error}</p>}
            </div>
          )}
        </ReviewAndSign>
      </div>
    </>
  );

  if (payload.version === 2) {
    return <SessionBound loadedFor={loadedFor}>{review}</SessionBound>;
  }
  return review;
}
