"use client";

/// "Quote in EURC" for what's still owed on one invoice. On demand only, so viewing a receipt or a
/// history row never calls Circle. There's deliberately no way to act on the quote from here.

import { useState } from "react";
import { quoteInvoiceRemainingInEurc } from "../../src/app/app/quote/actions";
import { eurcQuoteEnabled, formatQuoteTime, roundDecimalString, type EurcQuoteResult } from "../../src/kits/quoteFormat";

const FAILURE_COPY: Record<Exclude<EurcQuoteResult, { ok: true }>["reason"], string> = {
  nothing_remaining: "Nothing is still owed on this invoice.",
  not_found: "This invoice isn't in Contraflow's current registry.",
  rate_limited: "Too many quotes. Try again in a minute.",
  unavailable: "Quote unavailable right now.",
};

export function EurcQuote({ invoiceId, className = "" }: { invoiceId: string; className?: string }) {
  const [state, setState] = useState<"idle" | "loading" | EurcQuoteResult>("idle");

  if (!eurcQuoteEnabled()) return null;

  async function load() {
    setState("loading");
    try {
      setState(await quoteInvoiceRemainingInEurc(invoiceId));
    } catch {
      setState({ ok: false, reason: "unavailable" });
    }
  }

  const button = (label: string) => (
    <button type="button" onClick={load} className="text-gold hover:underline">
      {label}
    </button>
  );

  return (
    <div className={`text-xs ${className}`} aria-live="polite">
      {state === "idle" && button("Quote in EURC")}
      {state === "loading" && <span className="text-muted">Getting a quote…</span>}
      {typeof state === "object" && !state.ok && (
        <span className="text-muted">
          {FAILURE_COPY[state.reason]} {state.reason !== "nothing_remaining" && state.reason !== "not_found" && button("Try again")}
        </span>
      )}
      {typeof state === "object" && state.ok && (
        <div className="space-y-1">
          <p
            className="tabular-nums text-foreground/90"
            title={`${state.quote.amountInUsdc} USDC ≈ ${state.quote.estimatedOutputEurc} EURC`}
          >
            {roundDecimalString(state.quote.amountInUsdc, 2)} USDC ≈{" "}
            <span className="text-gold">{roundDecimalString(state.quote.estimatedOutputEurc, 2)} EURC</span>
          </p>
          <p className="text-muted">
            Circle Swap Kit quote on {state.quote.chainLabel} at {formatQuoteTime(state.quote.quotedAt)}. Quote only:
            nothing is swapped. Fees and slippage apply to a real swap. {button("Refresh")}
          </p>
        </div>
      )}
    </div>
  );
}
