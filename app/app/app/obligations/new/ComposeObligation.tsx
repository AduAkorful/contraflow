"use client";

import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { getAddress, isAddress, type Address } from "viem";
import { useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useContraflowSignTypedData } from "../../../../components/wallet/useContraflowSignTypedData";
import { useSignIn } from "../../../../components/wallet/useSignIn";
import { earlyNettingHelper, obligationSigningConfirmation } from "../../../../src/format/signing";
import { signingInLabel } from "../../../../src/session/signInCopy";
import { isEmbeddedWalletClient } from "../../../../src/session/signingWallet";
import { ObligationTerms } from "../../../../components/netting/ObligationTerms";
import { ComposerFrame } from "../../../../components/ui/ComposerFrame";
import { Field, inputClass } from "../../../../components/ui/Field";
import { Segmented } from "../../../../components/ui/Segmented";
import { shortAddr } from "../../../../components/netting/format";
import { randomBlinding } from "../../../../src/netting/commitment";
import { formatAmount, isIsoCurrency, parseAmount } from "../../../../src/netting/currency";
import { appLedgerDomain } from "../../../../src/netting/domain";
import {
  obligationDocumentProblem,
  obligationFromDocument,
  OBLIGATION_DOCUMENT_FORMAT,
  type CanonicalObligationDocument,
} from "../../../../src/netting/document";
import { obligationTypedData } from "../../../../src/netting/obligation";
import { prepareWalletContext } from "../../../../src/attest/walletContext";
import { serializeObligation } from "../../../../src/netting/serialize";
import type { NettingObligation } from "../../../../src/netting/types";
import { createProposal } from "../actions";

type Phase = "compose" | "review" | "signing" | "done";
type Role = "debtor" | "creditor";

const ROLE_OPTIONS = [
  { value: "creditor", label: "They owe me" },
  { value: "debtor", label: "I owe them" },
] as const;

const NEXT_STEPS = [
  { title: "You sign", body: "One signature, free: no transaction and no gas." },
  { title: "Your counterparty signs", body: "They open your link, sign in with the wallet it names and co-sign. Its terms are shown only to the two of you." },
  { title: "It's ready to net", body: "A signed obligation can join a loop with others. One certificate, signed by everyone in the loop, nets the same amount off each." },
] as const;

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "GHS", "NGN", "KES", "ZAR", "JPY"];
const OTHER = "OTHER";

export function ComposeObligation({ signerAddress }: { signerAddress: string }) {
  const { address, isConnected, connector } = useAccount();
  const { signTypedData } = useContraflowSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { start } = useSignIn();
  const { setActiveWallet } = useSetActiveWallet();
  const { wallets } = useWallets();
  const signingKind = isEmbeddedWalletClient(wallets.find((w) => w.address.toLowerCase() === address?.toLowerCase())?.walletClientType)
    ? "embedded"
    : "external";

  const [role, setRole] = useState<Role>("creditor");
  const [counterparty, setCounterparty] = useState("");
  const [currencyChoice, setCurrencyChoice] = useState("USD");
  const [otherCurrency, setOtherCurrency] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [description, setDescription] = useState("");
  const [earlyNetConsent, setEarlyNetConsent] = useState(true);

  const [phase, setPhase] = useState<Phase>("compose");
  const [draft, setDraft] = useState<{ document: CanonicalObligationDocument; obligation: NettingObligation } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const currency = currencyChoice === OTHER ? otherCurrency.trim().toUpperCase() : currencyChoice;

  function handleContinueToReview() {
    setError(null);
    if (!isAddress(counterparty.trim())) return setError("Enter a valid counterparty address.");
    const other = getAddress(counterparty.trim());
    const me = getAddress(signerAddress);
    if (other === me) return setError("The counterparty must be a different address from yours.");
    if (!isIsoCurrency(currency)) return setError("Enter a three-letter ISO currency code, like USD or GHS.");

    let amount: string;
    try {
      amount = formatAmount(parseAmount(amountInput, currency), currency);
    } catch (err) {
      return setError(err instanceof Error ? err.message : "Enter a valid amount.");
    }

    const document: CanonicalObligationDocument = {
      format: OBLIGATION_DOCUMENT_FORMAT,
      description: description.trim(),
      debtor: role === "debtor" ? me : other,
      creditor: role === "creditor" ? me : other,
      currency,
      amount,
      maturity: maturityDate,
      earlyNetConsent,
    };
    const problem = obligationDocumentProblem(document);
    if (problem) return setError(`${problem}.`);

    setDraft({ document, obligation: obligationFromDocument(document, randomBlinding()) });
    setPhase("review");
  }

  async function handleSign() {
    if (!draft) return;
    setError(null);
    setPhase("signing");
    try {
      const chainId = Number(appLedgerDomain().chainId);
      await prepareWalletContext(connector, signerAddress as Address, chainId, switchChainAsync);
      const signature = await signTypedData(obligationTypedData(draft.obligation, appLedgerDomain()), {
        title: "Confirm this obligation",
        description: obligationSigningConfirmation({
          youOwe: role === "debtor",
          amountMinor: draft.obligation.amount.toString(),
          currency: draft.document.currency,
          counterparty: role === "debtor" ? draft.document.creditor : draft.document.debtor,
          maturity: draft.document.maturity,
          earlyNetConsent: draft.document.earlyNetConsent,
        }),
      });
      await prepareWalletContext(connector, signerAddress as Address, chainId, switchChainAsync);
      const result = await createProposal({
        obligation: serializeObligation(draft.obligation),
        document: draft.document,
        proposerRole: role,
        proposerSignature: signature,
      });
      if (!result.ok) {
        setError(result.error);
        setPhase("review");
        return;
      }
      setLink(`${window.location.origin}/app/o/${result.token}`);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signing failed.");
      setPhase("review");
    }
  }

  if (phase === "done" && link) {
    return (
      <ComposerFrame step={2} next={NEXT_STEPS}>
      <div className="animate-card-entrance rounded-card border border-gold/30 bg-gold/[0.06] p-6 text-center">
        <p className="text-sm text-muted">Send this link to your counterparty:</p>
        <div className="mt-4 break-all rounded-lg border border-border-subtle bg-surface-1 p-3 font-mono text-sm">{link}</div>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          aria-label="Copy proposal link to clipboard"
          className="mt-4 rounded-pill bg-gold px-5 py-2 text-sm font-medium text-black hover:scale-[1.02]"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <p role="status" aria-live="polite" className="sr-only">
          {copied ? "Link copied to clipboard" : ""}
        </p>
        <p className="mt-4 text-xs text-muted">
          It&apos;s shown only to them, after they sign in with the account it names. It expires in 30 days.
        </p>
        <a href="/app/obligations" className="mt-4 inline-block text-xs text-gold hover:underline">
          View your obligations →
        </a>
      </div>
      </ComposerFrame>
    );
  }

  if ((phase === "review" || phase === "signing") && draft) {
    return (
      <ComposerFrame step={1} next={NEXT_STEPS}>
      <ObligationTerms document={draft.document} obligation={draft.obligation} viewerRole={role}>
        <div className="flex flex-col items-center gap-3">
          <p className="max-w-sm text-center text-xs text-muted">
            {obligationSigningConfirmation({
              youOwe: role === "debtor",
              amountMinor: draft.obligation.amount.toString(),
              currency: draft.document.currency,
              counterparty: role === "debtor" ? draft.document.creditor : draft.document.debtor,
              maturity: draft.document.maturity,
              earlyNetConsent: draft.document.earlyNetConsent,
            })}
          </p>
          <button
            onClick={handleSign}
            disabled={phase === "signing"}
            className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
          >
            {phase === "signing" ? signingInLabel(signingKind) : "Sign & create link"}
          </button>
          <button onClick={() => setPhase("compose")} className="text-xs text-muted hover:underline">
            ← Back to edit
          </button>
          {error && <p role="alert" className="text-center text-xs text-danger">{error}</p>}
        </div>
      </ObligationTerms>
      </ComposerFrame>
    );
  }

  if (!isConnected || address?.toLowerCase() !== signerAddress.toLowerCase()) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface-1 p-6 text-center">
        <p className="text-sm text-muted">
          {isConnected
            ? `Your connected wallet (${shortAddr(address as Address)}) doesn't match the address you signed in with (${shortAddr(signerAddress)}). Switch accounts in your wallet, or connect the right one below.`
            : `You're signed in as ${shortAddr(signerAddress)}, but your wallet isn't connected in this tab. Reconnect it to continue.`}
        </p>
        <button
          onClick={() => {
            const match = wallets.find((w) => w.address.toLowerCase() === signerAddress.toLowerCase());
            if (match) void setActiveWallet(match);
            else start();
          }}
          className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
        >
          Connect the signed-in account
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

        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label="Currency">
            {(p) => (
              <select {...p} value={currencyChoice} onChange={(e) => setCurrencyChoice(e.target.value)} className={inputClass}>
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={OTHER}>Other…</option>
              </select>
            )}
          </Field>
          <Field label="Amount">
            {(p) => (
              <input
                {...p}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="1250.00"
                inputMode="decimal"
                className={inputClass}
              />
            )}
          </Field>
        </div>
        {currencyChoice === OTHER && (
          <Field label="ISO currency code" hint="Three letters, like CHF.">
            {(p) => (
              <input
                {...p}
                value={otherCurrency}
                onChange={(e) => setOtherCurrency(e.target.value)}
                placeholder="CHF"
                maxLength={3}
                className={`${inputClass} uppercase`}
              />
            )}
          </Field>
        )}

        <Field label="Maturity date">
          {(p) => <input {...p} type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className={inputClass} />}
        </Field>

        <Field label="What's this for?" hint="Hashed and signed as part of this obligation. Your counterparty sees it before they sign too.">
          {(p) => (
            <textarea
              {...p}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Invoice #, PO #, or a short description of what this is for"
              rows={2}
              maxLength={500}
              className={`${inputClass} resize-none`}
            />
          )}
        </Field>

        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" className="mt-0.5 accent-gold" checked={earlyNetConsent} onChange={(e) => setEarlyNetConsent(e.target.checked)} />
          <span>
            Allow this to be netted before its maturity date
            {maturityDate && <span className="mt-1 block text-xs text-faint">{earlyNettingHelper(maturityDate, earlyNetConsent)}</span>}
          </span>
        </label>

        <button
          onClick={handleContinueToReview}
          className="mt-1 rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02]"
        >
          Continue to review
        </button>
        {error && (
          <p role="alert" className="text-center text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </ComposerFrame>
  );
}
