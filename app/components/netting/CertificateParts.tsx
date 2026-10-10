"use client";

import { useState } from "react";
import { isAddressEqual, type Address } from "viem";
import { Address as AddressText } from "../ui/Address";
import { displayDate, displayMinorAmount, shortAddr } from "./format";
import { statusMark, type CheckGroup } from "./checks";
import type { CertificateEntry, EntryDocument } from "../../src/netting/types";

/// Pieces of the certificate page: the loop of parties, a party's own obligation, the browser
/// check list and the action button.

export function LoopParties({
  entries,
  me,
  awaiting,
  shareUrl,
}: {
  entries: readonly CertificateEntry[];
  me: Address;
  /// Per entry, whether that party still has to sign; null once signing is over.
  awaiting: boolean[] | null;
  shareUrl: string;
}) {
  const [copiedReminder, setCopiedReminder] = useState(false);
  const first = entries[0];
  if (!first) return null;
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-2 font-mono text-sm">
      {entries.map((e, i) => (
        <li key={i} className="flex items-center gap-2">
          <span className={isAddressEqual(e.debtor, me) ? "text-gold" : ""}>
            {isAddressEqual(e.debtor, me) ? "You" : shortAddr(e.debtor)}
          </span>
          <span className="text-xs text-muted">owes →</span>
          {awaiting?.[i] && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  setCopiedReminder(true);
                  setTimeout(() => setCopiedReminder(false), 1500);
                } catch {
                  // Clipboard can be unavailable.
                }
              }}
              className="text-xs text-gold hover:underline"
            >
              {copiedReminder ? "Copied" : "Copy reminder link"}
            </button>
          )}
        </li>
      ))}
      <li className={isAddressEqual(first.debtor, me) ? "text-gold" : ""}>
        {isAddressEqual(first.debtor, me) ? "You" : shortAddr(first.debtor)}
      </li>
    </ol>
  );
}

export function OwnObligation({ doc, me, currency }: { doc: EntryDocument; me: Address; currency: string }) {
  const youOwe = isAddressEqual(doc.obligation.debtor, me);
  const counterparty = youOwe ? doc.obligation.creditor : doc.obligation.debtor;
  return (
    <div className="rounded-lg border border-white/10 p-4 text-sm">
      <p>
        {youOwe ? "You owe" : "Owed to you by"} <AddressText address={counterparty} />
      </p>
      <p className="mt-2">
        <span className="text-muted">{displayMinorAmount(doc.remainingBefore.toString(), currency)}</span>
        {" → "}
        <span className="text-gold">{displayMinorAmount(doc.remainingAfter.toString(), currency)}</span>
      </p>
      <p className="mt-1 text-xs text-muted">Due {displayDate(doc.obligation.maturity.toString())}</p>
    </div>
  );
}

export function CheckList({ groups }: { groups: CheckGroup[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-1 text-left text-sm">
      {groups.map((g) => (
        <li key={g.label} className="flex items-center gap-2">
          <span aria-hidden className={g.status === "pass" ? "text-gold" : g.status === "fail" ? "text-red-300" : "text-muted"}>
            {statusMark(g.status)}
          </span>
          <span>{g.label}</span>
          {g.status !== "pass" && <span className="text-xs text-muted">({g.status === "fail" ? "failed" : "couldn't check"})</span>}
        </li>
      ))}
    </ul>
  );
}

export function ActionButton({ onClick, busy, label }: { onClick: () => void; busy: string | null; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy !== null}
      className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
    >
      {busy ?? label}
    </button>
  );
}
