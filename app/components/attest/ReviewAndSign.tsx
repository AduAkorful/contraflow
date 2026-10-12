"use client";

/// The one "review & sign" component serving both landing spots: Party A's confirm-before-send
/// step and Party B's link-landing page. Plain-language terms by default (amount, counterparty,
/// maturity,
/// earlyNetConsent, network); the raw signed struct is available expanded, never the default view.

import { useState } from "react";
import type { InvoiceAttestation } from "../../src/attest/signAttestation";
import { Address } from "../ui/Address";
import { arcNetworkName } from "../../src/chain/client";
import { earlyNettingReview } from "../../src/format/signing";
import { Money } from "../ui/Money";
import { formatUsdcAmount } from "../../src/attest/amount";

function formatMaturity(maturity: bigint): string {
  // Same format as every other date in the signing flow ("31 December 2026", UTC), not the
  // browser's locale, which printed "December 31, 2026" next to "31 December 2026".
  return new Date(Number(maturity) * 1000).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ReviewAndSign({
  invoice,
  viewerRole,
  description,
  children,
}: {
  invoice: InvoiceAttestation;
  viewerRole: "debtor" | "creditor" | null;
  description?: string;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const counterparty = viewerRole === null ? null : viewerRole === "debtor" ? invoice.creditor : invoice.debtor;
  const verb = viewerRole === null ? "Invoice amount" : viewerRole === "debtor" ? "You owe" : "You are owed";

  return (
    <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 sm:p-8">
      <p className="text-xs uppercase tracking-wide text-muted">Invoice terms</p>
      <p className="mt-3 heading-2">
        {verb} <span className="text-gold"><Money value={formatUsdcAmount(invoice.amount)} /></span>
      </p>
      {description && <p className="mt-2 whitespace-pre-line text-sm text-muted [overflow-wrap:anywhere]">{description}</p>}

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Counterparty</dt>
          <dd className="mt-1">{counterparty ? <Address address={counterparty} /> : "Both invoice parties"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Maturity</dt>
          <dd className="mt-1">{formatMaturity(invoice.maturity)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Early netting</dt>
          <dd className="mt-1">{earlyNettingReview(String(invoice.maturity), invoice.earlyNetConsent)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Network</dt>
          <dd className="mt-1">{arcNetworkName(Number(invoice.chainId))} · {invoice.chainId.toString()}</dd>
        </div>
      </dl>

      <button onClick={() => setExpanded((v) => !v)} className="mt-6 text-xs text-muted hover:underline">
        {expanded ? "Hide the exact data you sign" : "See the exact data you sign"}
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
