"use client";

/// The one "review & sign" component serving both landing spots — plan 14 design decision 3
/// (plans/21-real-mode-attest-flow.md): Party A's confirm-before-send step and Party B's
/// link-landing page. Plain-language terms by default (amount, counterparty, maturity,
/// earlyNetConsent, network); the raw signed struct is available expanded, never the default view.

import { useState } from "react";
import type { InvoiceAttestation } from "../../src/attest/signAttestation";

const USDC_DECIMALS = 1_000_000n;
function formatUsdc(baseUnits: bigint): string {
  return (Number(baseUnits) / Number(USDC_DECIMALS)).toFixed(2);
}

function formatMaturity(maturity: bigint): string {
  return new Date(Number(maturity) * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ReviewAndSign({
  invoice,
  viewerRole,
  children,
}: {
  invoice: InvoiceAttestation;
  viewerRole: "debtor" | "creditor";
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const counterparty = viewerRole === "debtor" ? invoice.creditor : invoice.debtor;
  const verb = viewerRole === "debtor" ? "You owe" : "You are owed";

  return (
    <div className="animate-card-entrance rounded-card border border-white/10 bg-white/[0.02] p-6 sm:p-8">
      <p className="text-xs uppercase tracking-wide text-muted">Invoice terms</p>
      <p className="mt-3 font-serif-display text-2xl">
        {verb} <span className="text-gold">${formatUsdc(invoice.amount)}</span>
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Counterparty</dt>
          <dd className="mt-1 font-mono">{shortAddr(counterparty)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Maturity</dt>
          <dd className="mt-1">{formatMaturity(invoice.maturity)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Early netting</dt>
          <dd className="mt-1">{invoice.earlyNetConsent ? "Allowed before maturity" : "Only after maturity"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Network</dt>
          <dd className="mt-1">Arc Testnet · {invoice.chainId.toString()}</dd>
        </div>
      </dl>

      <button onClick={() => setExpanded((v) => !v)} className="mt-6 text-xs text-muted hover:underline">
        {expanded ? "Hide raw struct" : "View raw signed struct"}
      </button>
      {expanded && (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-4 text-xs text-muted">
          {JSON.stringify(
            invoice,
            (_key, value) => (typeof value === "bigint" ? value.toString() : value),
            2,
          )}
        </pre>
      )}

      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
