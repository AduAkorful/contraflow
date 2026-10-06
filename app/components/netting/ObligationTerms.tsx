"use client";

/// The terms of a Mode B obligation, in plain language, for both the proposer's review step and
/// the counterparty's landing page. The raw signed struct is available expanded, never the
/// default view.

import { useState } from "react";
import type { CanonicalObligationDocument } from "../../src/netting/document";
import { serializeObligation } from "../../src/netting/serialize";
import type { NettingObligation } from "../../src/netting/types";
import { Address } from "../ui/Address";
import { displayDate, displayMajorAmount } from "./format";

export function ObligationTerms({
  document,
  obligation,
  viewerRole,
  children,
}: {
  document: CanonicalObligationDocument;
  obligation: NettingObligation;
  viewerRole: "debtor" | "creditor";
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const counterparty = viewerRole === "debtor" ? document.creditor : document.debtor;

  return (
    <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 sm:p-8">
      <p className="text-xs uppercase tracking-wide text-muted">Obligation terms</p>
      <p className="mt-3 figure text-2xl">
        {viewerRole === "debtor" ? "You owe" : "You are owed"}{" "}
        <span className="text-gold">{displayMajorAmount(document.amount, document.currency)}</span>
      </p>
      <p className="mt-2 whitespace-pre-line text-sm text-muted">{document.description.trim()}</p>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Counterparty</dt>
          <dd className="mt-1"><Address address={counterparty} /></dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Maturity</dt>
          <dd className="mt-1">{displayDate(document.maturity)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Early netting</dt>
          <dd className="mt-1">{document.earlyNetConsent ? "Can be netted: anytime before its due date" : `Can be netted: only after ${displayDate(document.maturity)} (early netting off)`}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Currency</dt>
          <dd className="mt-1">{document.currency} · settled outside Contraflow</dd>
        </div>
      </dl>

      <p className="mt-6 text-xs text-muted">
        Contraflow stores signed obligations so it can find netting loops. This one is shown only to you and your
        counterparty, and its amount never goes onchain.
      </p>

      <button onClick={() => setExpanded((v) => !v)} className="mt-4 text-xs text-muted hover:underline">
        {expanded ? "Hide the exact data you sign" : "See the exact data you sign"}
      </button>
      {expanded && (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-4 text-xs text-muted">
          {JSON.stringify(serializeObligation(obligation), null, 2)}
        </pre>
      )}

      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
