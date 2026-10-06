"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Address } from "../../../components/ui/Address";
import { displayDate, displayMajorAmount, displayMinorAmount } from "../../../components/netting/format";
import { earlyNettingReview } from "../../../src/format/signing";
import {
  obligationPositionByCurrency,
  obligationPositionLine,
  obligationStatusLabel,
} from "../../../src/obligations/position";
import type { ObligationSummary, ProposalSummary } from "../../../src/obligations/service";
import { closeObligation, withdrawProposal } from "./actions";

const OUT_OF_SYNC_EXPLAINED =
  "Its recorded state disagrees with the ledger, for example after a certificate was applied outside Contraflow. It won't be netted from here again.";
const CLOSE_CONFIRM =
  "Close this obligation? It can't be undone, and it won't be netted in any certificate.";

export function ObligationsList({
  proposals,
  obligations,
}: {
  proposals: ProposalSummary[];
  obligations: ObligationSummary[];
}) {
  const router = useRouter();
  const [confirmingClose, setConfirmingClose] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.error ?? "Something went wrong.");
    setConfirmingClose(null);
    router.refresh();
  }

  if (proposals.length === 0 && obligations.length === 0) {
    return (
      <p className="mt-10 text-center text-sm text-muted">
        Nothing yet.{" "}
        <a href="/app/obligations/new" className="text-gold hover:underline">
          Record your first debt →
        </a>
      </p>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>
      )}

      {obligationPositionByCurrency(obligations).map((row) => (
        <p key={row.currency} className="text-sm">
          {obligationPositionLine(row)}
        </p>
      ))}

      {proposals.length > 0 && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Waiting for a signature</h2>
          <div className="mt-3 divide-y divide-white/10 rounded-card border border-white/10 bg-white/[0.02]">
            {proposals.map((p) => {
              const link = `/app/o/${p.token}`;
              return (
                <div key={p.token} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {p.youOwe ? "You owe" : "Owed to you by"}{" "}
                      <Address address={p.counterparty} className="text-foreground/90" />
                    </p>
                    <p className="mt-1 truncate text-xs text-muted">
                      {displayMajorAmount(p.amount, p.currency)} · {p.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {p.waitingOn === "you" ? (
                      <a href={link} className="text-gold hover:underline">
                        Review &amp; sign →
                      </a>
                    ) : (
                      <>
                        <button
                          onClick={async () => {
                            await navigator.clipboard.writeText(`${window.location.origin}${link}`);
                            setCopied(p.token);
                            setTimeout(() => setCopied(null), 2000);
                          }}
                          className="text-gold hover:underline"
                        >
                          {copied === p.token ? "Copied!" : "Copy link"}
                        </button>
                        <button onClick={() => run(() => withdrawProposal(p.token))} className="text-muted hover:underline">
                          Withdraw
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {obligations.length > 0 && (
        <div>
          <h2 className="text-xs uppercase tracking-wide text-muted">Signed obligations</h2>
          <p className="mt-1 text-xs text-muted">Closing an obligation stops it from being netted in any certificate. It can&apos;t be undone.</p>
          <div className="mt-3 divide-y divide-white/10 rounded-card border border-white/10 bg-white/[0.02]">
            {obligations.map((o) => (
              <div key={o.obligationId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm">
                    {o.youOwe ? "You owe" : "Owed to you by"}{" "}
                    <Address address={o.counterparty} className="text-foreground/90" />
                  </p>
                  <p className="mt-1 truncate text-xs text-muted">
                    {displayMinorAmount(o.amount, o.currency)}
                    {o.remaining !== o.amount && <> · {displayMinorAmount(o.remaining, o.currency)} remaining</>} · due{" "}
                    {displayDate(o.maturity)}
                    {!o.earlyNetConsent ? <> · {earlyNettingReview(o.maturity, false)}</> : null} · {o.description}
                  </p>
                  {o.status === "out_of_sync" && <p className="mt-1 text-xs text-muted">{OUT_OF_SYNC_EXPLAINED}</p>}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span
                    title={o.status === "out_of_sync" ? OUT_OF_SYNC_EXPLAINED : undefined}
                    className={`rounded-pill border px-3 py-1 ${
                      o.status === "active" && o.remaining !== "0"
                        ? "border-gold/30 bg-gold/10 text-gold"
                        : "border-white/15 text-muted"
                    }`}
                  >
                    {obligationStatusLabel(o)}
                  </span>
                  {(o.status === "active" || o.status === "out_of_sync") &&
                    (confirmingClose === o.obligationId ? (
                      <>
                        <p className="max-w-xs text-xs text-muted">{CLOSE_CONFIRM}</p>
                        <button onClick={() => run(() => closeObligation(o.obligationId))} className="text-red-300 hover:underline">
                          Confirm close
                        </button>
                        <button onClick={() => setConfirmingClose(null)} className="text-muted hover:underline">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmingClose(o.obligationId)}
                        title="Stop this obligation from being netted. This can't be undone."
                        className="text-muted hover:underline"
                      >
                        Close
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
