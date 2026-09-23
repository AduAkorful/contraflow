"use client";

import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { isAddress, type Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { ReviewAndSign } from "../../../components/attest/ReviewAndSign";
import { invoiceAttestationTypedData, type InvoiceAttestation } from "../../../src/attest/signAttestation";
import { encodeAttestLink } from "../../../src/attest/link";
import { hashInvoiceDocument, type CanonicalInvoiceDocument } from "../../../src/attest/document";
import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../../../src/contracts/addresses";
import { requestGrant, nextNonceFor, saveInvoiceDocument } from "./actions";

type Phase = "compose" | "review" | "signing" | "done";
type Role = "debtor" | "creditor";

function dateToUnixSeconds(dateStr: string): bigint {
  return BigInt(Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000));
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ComposeForm({ signerAddress }: { signerAddress: string }) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { login } = usePrivy();

  const [counterparty, setCounterparty] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [description, setDescription] = useState("");
  const [earlyNetConsent, setEarlyNetConsent] = useState(false);
  const [role, setRole] = useState<Role>("creditor"); // default: "they owe me"

  const [phase, setPhase] = useState<Phase>("compose");
  const [invoice, setInvoice] = useState<InvoiceAttestation | null>(null);
  const [invoiceDocument, setInvoiceDocument] = useState<CanonicalInvoiceDocument | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grantNote, setGrantNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function ensureGrant() {
    const result = await requestGrant();
    if (result.ok && !result.alreadyGranted) {
      setGrantNote("Your wallet was funded for its first transaction on Arc testnet.");
    }
  }

  async function handleContinueToReview() {
    setError(null);
    if (!isAddress(counterparty)) {
      setError("Enter a valid counterparty address.");
      return;
    }
    const amount = Number(amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    if (!maturityDate) {
      setError("Pick a maturity date.");
      return;
    }
    if (!description.trim()) {
      setError("Describe what this invoice is for.");
      return;
    }

    await ensureGrant();

    const debtor = (role === "debtor" ? signerAddress : counterparty) as Address;
    const creditor = (role === "creditor" ? signerAddress : counterparty) as Address;

    const nonceResult = await nextNonceFor(debtor, creditor);
    if (!nonceResult.ok) {
      setError(nonceResult.error);
      return;
    }

    const doc: CanonicalInvoiceDocument = {
      description: description.trim(),
      debtor,
      creditor,
      amountUsdc: amount.toFixed(2),
      maturity: maturityDate,
    };
    const invoiceRef = hashInvoiceDocument(doc);

    const saveResult = await saveInvoiceDocument(invoiceRef, doc);
    if (!saveResult.ok) {
      setError(saveResult.error);
      return;
    }

    const { registry, usdc } = addressesForChain(ARC_TESTNET_CHAIN_ID);
    const built: InvoiceAttestation = {
      invoiceRef,
      amount: BigInt(Math.round(amount * 1_000_000)),
      currency: usdc,
      maturity: dateToUnixSeconds(maturityDate),
      earlyNetConsent,
      debtor,
      creditor,
      nonce: BigInt(nonceResult.nonce),
      registry,
      chainId: BigInt(ARC_TESTNET_CHAIN_ID),
    };
    setInvoice(built);
    setInvoiceDocument(doc);
    setPhase("review");
  }

  async function handleSign() {
    if (!invoice || !invoiceDocument) return;
    setError(null);
    setPhase("signing");
    try {
      const typedData = invoiceAttestationTypedData(invoice);
      const signatureA = await signTypedDataAsync(typedData);
      const encoded = encodeAttestLink({ invoice, role, signatureA, document: invoiceDocument });
      const url = `${window.location.origin}/app/attest/${encoded}`;
      setLink(url);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign.");
      setPhase("review");
    }
  }

  if (phase === "done" && link) {
    return (
      <div className="animate-card-entrance rounded-card border border-gold/30 bg-gold/[0.06] p-6 text-center">
        <p className="text-sm text-muted">Share this link with your counterparty:</p>
        <div className="mt-4 break-all rounded-lg border border-white/10 bg-black/30 p-3 text-xs font-mono">
          {link}
        </div>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          aria-label="Copy attestation link to clipboard"
          className="mt-4 rounded-pill bg-gold px-5 py-2 text-sm font-medium text-black hover:scale-[1.02]"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <p role="status" aria-live="polite" className="sr-only">
          {copied ? "Link copied to clipboard" : ""}
        </p>
        <p className="mt-4 text-xs text-muted">Nothing is registered on-chain until they sign too.</p>
      </div>
    );
  }

  if (phase === "review" && invoice) {
    return (
      <ReviewAndSign invoice={invoice} viewerRole={role} description={invoiceDocument?.description}>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleSign}
            disabled={phase !== "review"}
            className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02]"
          >
            Sign &amp; generate link
          </button>
          <button onClick={() => setPhase("compose")} className="text-xs text-muted hover:underline">
            ← Back to edit
          </button>
          {error && <p className="text-center text-xs text-red-300">{error}</p>}
        </div>
      </ReviewAndSign>
    );
  }

  if (!isConnected || address?.toLowerCase() !== signerAddress.toLowerCase()) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
        {isConnected ? (
          <p className="text-sm text-muted">
            Your connected wallet ({shortAddr(address ?? "")}) doesn&apos;t match the address you
            signed in with ({shortAddr(signerAddress)}). Switch accounts in your wallet, or connect
            the right one below.
          </p>
        ) : (
          <p className="text-sm text-muted">
            You&apos;re signed in as {shortAddr(signerAddress)}, but your wallet isn&apos;t connected
            in this tab. Reconnect it to continue.
          </p>
        )}
        <button
          onClick={() => login()}
          className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          onClick={() => setRole("creditor")}
          className={`flex-1 rounded-pill border px-4 py-2 text-sm ${role === "creditor" ? "border-gold bg-gold/10 text-gold" : "border-white/15 text-muted"}`}
        >
          They owe me
        </button>
        <button
          onClick={() => setRole("debtor")}
          className={`flex-1 rounded-pill border px-4 py-2 text-sm ${role === "debtor" ? "border-gold bg-gold/10 text-gold" : "border-white/15 text-muted"}`}
        >
          I owe them
        </button>
      </div>

      <label className="text-xs uppercase tracking-wide text-muted">
        Counterparty address
        <input
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder="0x..."
          className="mt-1 w-full rounded-lg border border-white/15 bg-white/[0.02] px-4 py-2.5 text-sm font-mono outline-none focus:border-gold/50"
        />
      </label>

      <label className="text-xs uppercase tracking-wide text-muted">
        Amount (USDC)
        <input
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          placeholder="1000.00"
          inputMode="decimal"
          className="mt-1 w-full rounded-lg border border-white/15 bg-white/[0.02] px-4 py-2.5 text-sm outline-none focus:border-gold/50"
        />
      </label>

      <label className="text-xs uppercase tracking-wide text-muted">
        Maturity date
        <input
          type="date"
          value={maturityDate}
          onChange={(e) => setMaturityDate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/15 bg-white/[0.02] px-4 py-2.5 text-sm outline-none focus:border-gold/50"
        />
      </label>

      <label className="text-xs uppercase tracking-wide text-muted">
        What&apos;s this for?
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Invoice #, PO #, or a short description of what this is for"
          rows={2}
          className="mt-1 w-full resize-none rounded-lg border border-white/15 bg-white/[0.02] px-4 py-2.5 text-sm outline-none focus:border-gold/50"
        />
      </label>
      <p className="-mt-2 text-xs text-muted">
        Hashed and signed as part of this invoice — your counterparty sees it before they sign too.
      </p>

      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={earlyNetConsent} onChange={(e) => setEarlyNetConsent(e.target.checked)} />
        Allow this invoice to be netted before its maturity date
      </label>

      <button
        onClick={handleContinueToReview}
        className="mt-2 rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02]"
      >
        Continue to review
      </button>

      {grantNote && <p className="text-center text-xs text-muted">{grantNote}</p>}
      {error && <p className="text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}
