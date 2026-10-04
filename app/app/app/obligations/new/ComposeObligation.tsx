"use client";

import { useState } from "react";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { getAddress, isAddress, type Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { ObligationTerms } from "../../../../components/netting/ObligationTerms";
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

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "GHS", "NGN", "KES", "ZAR", "JPY"];
const OTHER = "OTHER";

export function ComposeObligation({ signerAddress }: { signerAddress: string }) {
  const { address, isConnected, connector } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { login } = usePrivy();

  const [role, setRole] = useState<Role>("creditor");
  const [counterparty, setCounterparty] = useState("");
  const [currencyChoice, setCurrencyChoice] = useState("USD");
  const [otherCurrency, setOtherCurrency] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [description, setDescription] = useState("");
  const [earlyNetConsent, setEarlyNetConsent] = useState(false);

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
      const signature = await signTypedDataAsync(obligationTypedData(draft.obligation, appLedgerDomain()));
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
      <div className="animate-card-entrance rounded-card border border-gold/30 bg-gold/[0.06] p-6 text-center">
        <p className="text-sm text-muted">Send this link to your counterparty:</p>
        <div className="mt-4 break-all rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-sm">{link}</div>
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
          Only they can open it, after signing in with the wallet it names. It expires in 30 days.
        </p>
        <a href="/app/obligations" className="mt-4 inline-block text-xs text-gold hover:underline">
          View your obligations →
        </a>
      </div>
    );
  }

  if ((phase === "review" || phase === "signing") && draft) {
    return (
      <ObligationTerms document={draft.document} obligation={draft.obligation} viewerRole={role}>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleSign}
            disabled={phase === "signing"}
            className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
          >
            {phase === "signing" ? "Sign in your wallet..." : "Sign & create link"}
          </button>
          <button onClick={() => setPhase("compose")} className="text-xs text-muted hover:underline">
            ← Back to edit
          </button>
          {error && <p className="text-center text-xs text-red-300">{error}</p>}
        </div>
      </ObligationTerms>
    );
  }

  if (!isConnected || address?.toLowerCase() !== signerAddress.toLowerCase()) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm text-muted">
          {isConnected
            ? `Your connected wallet (${shortAddr(address as Address)}) doesn't match the address you signed in with (${shortAddr(signerAddress)}). Switch accounts in your wallet, or connect the right one below.`
            : `You're signed in as ${shortAddr(signerAddress)}, but your wallet isn't connected in this tab. Reconnect it to continue.`}
        </p>
        <button
          onClick={() => login()}
          className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  const input =
    "mt-1 w-full rounded-lg border border-border-input bg-surface-1 px-4 py-2.5 text-sm focus:border-focus";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(["creditor", "debtor"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`flex-1 rounded-pill border px-4 py-2 text-sm ${role === r ? "border-gold bg-gold/10 text-gold" : "border-white/15 text-muted"}`}
          >
            {r === "creditor" ? "They owe me" : "I owe them"}
          </button>
        ))}
      </div>

      <label className="text-xs uppercase tracking-wide text-muted">
        Counterparty address
        <input
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder="0x..."
          className={`${input} font-mono`}
        />
      </label>

      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <label className="text-xs uppercase tracking-wide text-muted">
          Currency
          <select value={currencyChoice} onChange={(e) => setCurrencyChoice(e.target.value)} className={input}>
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </select>
        </label>
        <label className="text-xs uppercase tracking-wide text-muted">
          Amount
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="1250.00"
            inputMode="decimal"
            className={input}
          />
        </label>
      </div>
      {currencyChoice === OTHER && (
        <label className="text-xs uppercase tracking-wide text-muted">
          ISO currency code
          <input
            value={otherCurrency}
            onChange={(e) => setOtherCurrency(e.target.value)}
            placeholder="CHF"
            maxLength={3}
            className={`${input} uppercase`}
          />
        </label>
      )}

      <label className="text-xs uppercase tracking-wide text-muted">
        Maturity date
        <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className={input} />
      </label>

      <label className="text-xs uppercase tracking-wide text-muted">
        What&apos;s this for?
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Invoice #, PO #, or a short description of what this is for"
          rows={2}
          maxLength={500}
          className={`${input} resize-none`}
        />
      </label>
      <p className="-mt-2 text-xs text-muted">
        Hashed and signed as part of this obligation. Your counterparty sees it before they sign too.
      </p>

      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={earlyNetConsent} onChange={(e) => setEarlyNetConsent(e.target.checked)} />
        Allow this to be netted before its maturity date
      </label>

      <button
        onClick={handleContinueToReview}
        className="mt-2 rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02]"
      >
        Continue to review
      </button>
      {error && <p className="text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}
