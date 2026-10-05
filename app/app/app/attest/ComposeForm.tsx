"use client";

import { useState } from "react";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { isAddress, type Address } from "viem";
import { formatAddress } from "../../../src/format/address";
import { usePrivy } from "@privy-io/react-auth";
import { ReviewAndSign } from "../../../components/attest/ReviewAndSign";
import { ComposerFrame } from "../../../components/ui/ComposerFrame";
import { Field, SuffixInput, inputClass } from "../../../components/ui/Field";
import { Segmented } from "../../../components/ui/Segmented";
import { invoiceAttestationTypedData, type InvoiceAttestation } from "../../../src/attest/signAttestation";
import { encodeAttestLink } from "../../../src/attest/link";
import { hashInvoiceDocument, type CanonicalInvoiceDocument } from "../../../src/attest/document";
import { formatUsdcAmount, parseUsdcAmount, UsdcAmountError } from "../../../src/attest/amount";
import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../../../src/contracts/addresses";
import { prepareWalletContext } from "../../../src/attest/walletContext";
import { requestGrant, nextNonceFor, saveInvoiceDocument } from "./actions";

type Phase = "compose" | "review" | "signing" | "done";
type Role = "debtor" | "creditor";

function dateToUnixSeconds(dateStr: string): bigint {
  return BigInt(Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000));
}

const ROLE_OPTIONS = [
  { value: "creditor", label: "They owe me" },
  { value: "debtor", label: "I owe them" },
] as const;

const NEXT_STEPS = [
  { title: "You sign", body: "One signature in your wallet. It's free: no transaction and no gas." },
  { title: "Your counterparty signs", body: "They open your link, check the terms, sign and register the invoice on Arc. Registering is the only step that costs gas, paid from their wallet." },
  { title: "It's on Arc", body: "A registered invoice can be netted against other registered invoices that form a loop." },
] as const;

export function ComposeForm({ signerAddress }: { signerAddress: string }) {
  const { address, isConnected, connector } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
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
    let amount: bigint;
    try {
      amount = parseUsdcAmount(amountUsd);
    } catch (err) {
      setError(err instanceof UsdcAmountError ? err.message : "Enter a valid USDC amount.");
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
      amountUsdc: formatUsdcAmount(amount),
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
      amount,
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
      await prepareWalletContext(connector, signerAddress as Address, ARC_TESTNET_CHAIN_ID, switchChainAsync);
      const typedData = invoiceAttestationTypedData(invoice);
      const signatureA = await signTypedDataAsync(typedData);
      await prepareWalletContext(connector, signerAddress as Address, ARC_TESTNET_CHAIN_ID, switchChainAsync);
      const encoded = encodeAttestLink({ invoice, role, signatureA });
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
      <ComposerFrame step={2} next={NEXT_STEPS}>
      <div className="animate-card-entrance rounded-card border border-gold/30 bg-gold/[0.06] p-6 text-center">
        <p className="text-sm text-muted">Share this link with your counterparty:</p>
        <div className="mt-4 break-all rounded-lg border border-border-subtle bg-surface-1 p-3 text-xs font-mono">
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
        <p className="mt-4 text-xs text-muted">Nothing is registered on Arc until they sign too.</p>
      </div>
      </ComposerFrame>
    );
  }

  if ((phase === "review" || phase === "signing") && invoice) {
    return (
      <ComposerFrame step={1} next={NEXT_STEPS}>
      <ReviewAndSign invoice={invoice} viewerRole={role} description={invoiceDocument?.description}>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleSign}
            disabled={phase === "signing"}
            className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
          >
            {phase === "signing" ? "Sign in your wallet..." : "Sign & generate link"}
          </button>
          <button onClick={() => setPhase("compose")} className="text-xs text-muted hover:underline">
            ← Back to edit
          </button>
          {error && <p role="alert" className="text-center text-xs text-danger">{error}</p>}
        </div>
      </ReviewAndSign>
      </ComposerFrame>
    );
  }

  if (!isConnected || address?.toLowerCase() !== signerAddress.toLowerCase()) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface-1 p-6 text-center">
        {isConnected ? (
          <p className="text-sm text-muted">
            Your connected wallet ({formatAddress(address ?? "")}) doesn&apos;t match the address you
            signed in with ({formatAddress(signerAddress)}). Switch accounts in your wallet, or connect
            the right one below.
          </p>
        ) : (
          <p className="text-sm text-muted">
            You&apos;re signed in as {formatAddress(signerAddress)}, but your wallet isn&apos;t connected
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
    <ComposerFrame step={0} next={NEXT_STEPS}>
      <div className="flex flex-col gap-5">
        <Segmented label="Who owes whom" value={role} options={ROLE_OPTIONS} onChange={setRole} />

        <Field label="Counterparty address">
          {(p) => (
            <input
              {...p}
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder="0x..."
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
          )}
        </Field>

        <Field label="Amount" hint="Up to 6 decimal places.">
          {(p) => (
            <SuffixInput
              {...p}
              suffix="USDC"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              placeholder="1000.00"
              inputMode="decimal"
            />
          )}
        </Field>

        <Field label="Maturity date">
          {(p) => <input {...p} type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className={inputClass} />}
        </Field>

        <Field label="What's this for?" hint="Hashed and signed as part of this invoice. Your counterparty sees it before they sign too.">
          {(p) => (
            <textarea
              {...p}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Invoice #, PO #, or a short description of what this is for"
              rows={2}
              className={`${inputClass} resize-none`}
            />
          )}
        </Field>

        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" className="accent-gold" checked={earlyNetConsent} onChange={(e) => setEarlyNetConsent(e.target.checked)} />
          Allow this invoice to be netted before its maturity date
        </label>

        <button
          onClick={handleContinueToReview}
          className="mt-1 rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02]"
        >
          Continue to review
        </button>

        {grantNote && <p className="text-center text-xs text-muted">{grantNote}</p>}
        {error && (
          <p role="alert" className="text-center text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </ComposerFrame>
  );
}
