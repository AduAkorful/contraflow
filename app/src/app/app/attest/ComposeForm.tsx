"use client";

import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { isAddress, type Address } from "viem";
import { useWallets } from "@privy-io/react-auth";
import { useContraflowSignTypedData } from "@/components/wallet/useContraflowSignTypedData";
import { useSignerWallet } from "@/components/wallet/useSignerWallet";
import { SignerWalletNotice } from "@/components/wallet/SignerWalletNotice";
import { earlyNettingHelper, invoiceSigningConfirmation, walletWindowNote } from "@/src/format/signing";
import { signingInLabel } from "@/src/session/signInCopy";
import { isEmbeddedWalletClient } from "@/src/session/signingWallet";
import { ReviewAndSign } from "@/components/attest/ReviewAndSign";
import { ComposerFrame } from "@/components/ui/ComposerFrame";
import { Field, SuffixInput, inputClass } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { invoiceAttestationTypedData, type InvoiceAttestation } from "@/src/attest/signAttestation";
import { encodeAttestLink } from "@/src/attest/link";
import { hashInvoiceDocument, type CanonicalInvoiceDocument } from "@/src/attest/document";
import { formatUsdcAmount, parseUsdcAmount, UsdcAmountError } from "@/src/attest/amount";
import { addressesForChain, APP_CHAIN_ID } from "@/src/contracts/addresses";
import { prepareWalletContext } from "@/src/attest/walletContext";
import { starterGrantToast } from "@/src/attest/grantCopy";
import { nextNonceFor, saveInvoiceDocument, createInvoiceLink } from "./actions";
import { requestGrant } from "../grant/actions";
import { MAX_DESCRIPTION_LENGTH } from "@/src/format/description";
import { isZeroAddress, pastMaturityNote } from "@/src/format/formChecks";

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
  { title: "You sign", body: "One signature, free: no transaction and no gas." },
  { title: "Your counterparty signs", body: "They open your link, check the terms, sign and register the invoice on Arc. Registering is the only step that costs gas, paid from their wallet." },
  { title: "It's on Arc", body: "A registered invoice can be netted against other registered invoices that form a loop." },
] as const;

export function ComposeForm({ signerAddress }: { signerAddress: string }) {
  const { address, connector } = useAccount();
  const { signTypedData } = useContraflowSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const signerWallet = useSignerWallet(signerAddress);
  const { wallets } = useWallets();
  const signingKind = isEmbeddedWalletClient(wallets.find((w) => w.address.toLowerCase() === address?.toLowerCase())?.walletClientType)
    ? "embedded"
    : "external";

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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"counterparty" | "amount" | "maturity" | "description", string>>>({});
  const [checking, setChecking] = useState(false);

  /// Editing a field clears its own problem, and the general one, so nothing stale stays on screen.
  function edit<T>(field: keyof typeof fieldErrors, set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setError(null);
      setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    };
  }

  async function ensureGrant() {
    const result = await requestGrant();
    if (result.ok && !result.alreadyGranted && result.amountUsdc) {
      setGrantNote(starterGrantToast(result.amountUsdc, APP_CHAIN_ID));
    }
  }

  async function handleContinueToReview() {
    if (checking) return;
    setChecking(true);
    try {
      await continueToReview();
    } catch (err) {
      // A step that throws must never leave the button looking dead.
      setError(err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");
    } finally {
      setChecking(false);
    }
  }

  async function continueToReview() {
    setError(null);
    const problems: typeof fieldErrors = {};
    const who = counterparty.trim();
    if (!isAddress(who)) problems.counterparty = "Enter a valid address, starting with 0x.";
    else if (isZeroAddress(who)) problems.counterparty = "That's the zero address. Enter your counterparty's address.";
    else if (signerAddress && who.toLowerCase() === signerAddress.toLowerCase()) {
      problems.counterparty = "The counterparty must be a different address from yours.";
    }
    let amount: bigint = 0n;
    try {
      amount = parseUsdcAmount(amountUsd);
    } catch (err) {
      problems.amount = err instanceof UsdcAmountError ? err.message : "Enter a valid USDC amount.";
    }
    if (!maturityDate) problems.maturity = "Pick a maturity date.";
    if (!description.trim()) problems.description = "Describe what this invoice is for.";
    else if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
      problems.description = `The description can be at most ${MAX_DESCRIPTION_LENGTH} characters.`;
    }
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) {
      setError("Fix the highlighted fields to continue.");
      return;
    }

    await ensureGrant();

    const debtor = (role === "debtor" ? signerAddress : counterparty.trim()) as Address;
    const creditor = (role === "creditor" ? signerAddress : counterparty.trim()) as Address;

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

    const { registry, usdc } = addressesForChain(APP_CHAIN_ID);
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
      chainId: BigInt(APP_CHAIN_ID),
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
      await prepareWalletContext(connector, signerAddress as Address, APP_CHAIN_ID, switchChainAsync);
      const typedData = invoiceAttestationTypedData(invoice);
      const signatureA = await signTypedData(typedData, {
        title: "Confirm this invoice",
        description: invoiceSigningConfirmation({
          youOwe: role === "debtor",
          amountUsdc: invoice.amount,
          counterparty: role === "debtor" ? invoice.creditor : invoice.debtor,
          maturity: invoice.maturity,
          earlyNetConsent: invoice.earlyNetConsent,
        }),
      });
      await prepareWalletContext(connector, signerAddress as Address, APP_CHAIN_ID, switchChainAsync);
      const encoded = encodeAttestLink({ invoice, role, signatureA });
      const stored = await createInvoiceLink(encoded);
      if (!stored.ok) {
        setError(stored.error);
        setPhase("review");
        return;
      }
      setLink(`${window.location.origin}/app/i/${stored.token}`);
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
        {grantNote && <p className="mt-4 text-xs text-muted">{grantNote}</p>}
        <p className="mt-4 text-xs text-muted">Nothing is registered on Arc until they sign too. The link works for 30 days.</p>
      </div>
      </ComposerFrame>
    );
  }

  if ((phase === "review" || phase === "signing") && invoice) {
    return (
      <ComposerFrame step={1} next={NEXT_STEPS}>
      <ReviewAndSign invoice={invoice} viewerRole={role} description={invoiceDocument?.description}>
        <div className="flex flex-col items-center gap-3">
          <p className="max-w-sm text-center text-xs text-muted">
            {invoiceSigningConfirmation({
              youOwe: role === "debtor",
              amountUsdc: invoice.amount,
              counterparty: role === "debtor" ? invoice.creditor : invoice.debtor,
              maturity: invoice.maturity,
              earlyNetConsent: invoice.earlyNetConsent,
            })}
          </p>
          <p className="max-w-sm text-center text-xs text-faint">{walletWindowNote(invoice.nonce)}</p>
          <SignerWalletNotice wallet={signerWallet} signerAddress={signerAddress} />
          <button
            onClick={handleSign}
            disabled={phase === "signing" || signerWallet.state !== "ready"}
            className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
          >
            {phase === "signing" ? signingInLabel(signingKind) : "Sign & generate link"}
          </button>
          <button onClick={() => setPhase("compose")} className="text-xs text-muted hover:underline">
            ← Back to edit
          </button>
          {grantNote && <p className="text-center text-xs text-muted">{grantNote}</p>}
          {error && <p role="alert" className="text-center text-xs text-danger">{error}</p>}
        </div>
      </ReviewAndSign>
      </ComposerFrame>
    );
  }

  return (
    <ComposerFrame step={0} next={NEXT_STEPS}>
      <div className="flex flex-col gap-5">
        <Segmented label="Who owes whom" value={role} options={ROLE_OPTIONS} onChange={setRole} />

        <Field label="Counterparty address" error={fieldErrors.counterparty}>
          {(p) => (
            <input
              {...p}
              value={counterparty}
              onChange={(e) => edit<string>("counterparty", setCounterparty)(e.target.value)}
              placeholder="0x..."
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
          )}
        </Field>

        <Field label="Amount" hint="Up to 6 decimal places." error={fieldErrors.amount}>
          {(p) => (
            <SuffixInput
              {...p}
              suffix="USDC"
              value={amountUsd}
              onChange={(e) => edit<string>("amount", setAmountUsd)(e.target.value)}
              placeholder="1000.00"
              inputMode="decimal"
            />
          )}
        </Field>

        <Field label="Maturity date" error={fieldErrors.maturity} note={pastMaturityNote(maturityDate)}>
          {(p) => <input {...p} type="date" value={maturityDate} onChange={(e) => edit<string>("maturity", setMaturityDate)(e.target.value)} className={inputClass} />}
        </Field>

        <Field
          label="What's this for?"
          hint={`Hashed and signed as part of this invoice. Your counterparty sees it before they sign too. ${description.length}/${MAX_DESCRIPTION_LENGTH}`}
          error={fieldErrors.description}
        >
          {(p) => (
            <textarea
              {...p}
              value={description}
              onChange={(e) => edit<string>("description", setDescription)(e.target.value)}
              placeholder="Invoice #, PO #, or a short description of what this is for"
              rows={2}
              maxLength={MAX_DESCRIPTION_LENGTH}
              className={`${inputClass} resize-none`}
            />
          )}
        </Field>

        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" className="mt-0.5 accent-gold" checked={earlyNetConsent} onChange={(e) => setEarlyNetConsent(e.target.checked)} />
          <span>
            Allow this invoice to be netted before its maturity date
            {maturityDate && <span className="mt-1 block text-xs text-faint">{earlyNettingHelper(maturityDate, earlyNetConsent)}</span>}
          </span>
        </label>

        <button
          onClick={handleContinueToReview}
          disabled={checking}
          aria-busy={checking}
          className="mt-1 rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
        >
          {checking ? "Checking…" : "Continue to review"}
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
