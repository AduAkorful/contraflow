"use client";

/// "What would this be in EURC?" for an amount the user types. Quote only: nothing is swapped and
/// nothing here can start a swap. On demand, so opening the page never calls Circle.

import { useState } from "react";
import { quoteUsdcAmount } from "../../src/app/app/quote/actions";
import { eurcQuoteEnabled, formatQuoteTime, roundDecimalString, type EurcQuoteResult } from "../../src/kits/quoteFormat";

const FAILURE_COPY: Record<Exclude<EurcQuoteResult, { ok: true }>["reason"], string> = {
  nothing_remaining: "Nothing to quote.",
  not_found: "Nothing to quote.",
  rate_limited: "Too many quotes. Try again in a minute.",
  unavailable: "Quote unavailable right now. Try again shortly.",
  invalid_amount: "Enter an amount above zero (up to 1,000,000), with at most 6 decimal places.",
  sign_in: "Sign in to get a quote.",
};

export function BalanceQuote({ walletUsdc }: { walletUsdc: string | null }) {
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<"idle" | "loading" | EurcQuoteResult>("idle");

  if (!eurcQuoteEnabled()) return null;

  async function load() {
    setState("loading");
    try {
      setState(await quoteUsdcAmount(amount));
    } catch {
      setState({ ok: false, reason: "unavailable" });
    }
  }

  return (
    <section aria-labelledby="eurc-quote-title" className="rounded-[20px] border border-border-subtle bg-surface-1 p-5">
      <h2 id="eurc-quote-title" className="text-sm font-medium">
        EURC quote
      </h2>
      <p className="mt-1 text-sm text-muted">See what an amount of USDC would be in EURC. Quote only: nothing is swapped.</p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label className="flex-1">
          <span className="text-sm text-muted">Amount in USDC</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="mt-1 w-full rounded-lg border border-border-input bg-bg px-4 py-3 text-base tabular-nums"
          />
        </label>
        {walletUsdc && Number(walletUsdc) > 0 && (
          <button type="button" onClick={() => setAmount(walletUsdc)} className="text-sm text-gold hover:underline sm:pb-3">
            Use wallet balance
          </button>
        )}
        <button
          type="submit"
          disabled={state === "loading" || amount.trim().length === 0}
          className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black disabled:state-disabled"
        >
          {state === "loading" ? "Getting a quote…" : "Get quote"}
        </button>
      </form>

      <div aria-live="polite" className="mt-4 text-sm">
        {typeof state === "object" && !state.ok && <p className="text-muted">{FAILURE_COPY[state.reason]}</p>}
        {typeof state === "object" && state.ok && (
          <div className="space-y-1">
            <p className="tabular-nums" title={`${state.quote.amountInUsdc} USDC ≈ ${state.quote.estimatedOutputEurc} EURC`}>
              {roundDecimalString(state.quote.amountInUsdc, 2)} USDC ≈{" "}
              <span className="text-gold">{roundDecimalString(state.quote.estimatedOutputEurc, 2)} EURC</span>
            </p>
            <p className="text-muted">
              Circle Swap Kit quote on {state.quote.chainLabel} at {formatQuoteTime(state.quote.quotedAt)}. Fees and slippage
              apply to a real swap.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
