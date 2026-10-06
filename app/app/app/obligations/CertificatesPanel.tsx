"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { displayDate, displayMinorAmount } from "../../../components/netting/format";
import type { CertificateSummary } from "../../../src/obligations/certificates";
import { findNettingLoop } from "./actions";

const STATUS_TEXT: Record<CertificateSummary["status"], string> = {
  collecting: "collecting signatures",
  ready: "ready to apply",
  applied: "applied",
  expired: "expired",
  abandoned: "cancelled",
};

function nextStep(c: CertificateSummary): string | null {
  if (c.status === "collecting") return c.youSigned ? `${c.signedCount} of ${c.parties} signed` : "Waiting for your signature";
  if (c.status === "ready") return "Anyone in the loop can apply it";
  return null;
}

export function CertificatesPanel({ certificates }: { certificates: CertificateSummary[] }) {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<{ token: string; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setSearching(true);
    setFound(null);
    setMessage(null);
    setError(null);
    try {
      const result = await findNettingLoop();
      if (!result.ok) return setError(result.error);
      const outcome = result.outcome;
      if (!outcome.found) return setMessage(outcome.message);
      setFound({
        token: outcome.token,
        text: `Loop found: ${outcome.parties} parties, ${displayMinorAmount(outcome.wNet, outcome.currency)} each.`,
      });
      router.refresh();
    } finally {
      setSearching(false);
    }
  }

  const open = certificates.filter((c) => c.status === "collecting" || c.status === "ready");
  const closed = certificates.filter((c) => c.status !== "collecting" && c.status !== "ready");

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={find}
          disabled={searching}
          className="rounded-pill border border-gold/40 px-5 py-2 text-sm text-gold hover:bg-gold/10 disabled:state-disabled"
        >
          {searching ? "Searching..." : "Find a netting loop"}
        </button>
        {found && (
          <p className="text-sm">
            {found.text}{" "}
            <a href={`/app/c/${found.token}`} className="text-gold hover:underline">
              Open →
            </a>
          </p>
        )}
        {message && <p className="text-sm text-muted">{message}</p>}
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>

      {certificates.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-wide text-muted">Netting certificates</h2>
          <div className="mt-3 divide-y divide-white/10 rounded-card border border-white/10 bg-white/[0.02]">
            {[...open, ...closed].map((c) => (
              <div key={c.token} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm">
                    {displayMinorAmount(c.wNet, c.currency)} off each of {c.parties} obligations
                  </p>
                  {/* The badge already shows the status, so the subtitle only appears when there's more to say. */}
                  {(nextStep(c) || c.status === "collecting" || c.status === "ready") && (
                    <p className="mt-1 text-xs text-muted">
                      {nextStep(c) ?? STATUS_TEXT[c.status]}
                      {(c.status === "collecting" || c.status === "ready") && <> · open until {displayDate(c.deadline)}</>}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span
                    className={`rounded-pill border px-3 py-1 ${
                      c.status === "applied" || c.status === "ready" ? "border-gold/30 bg-gold/10 text-gold" : "border-white/15 text-muted"
                    }`}
                  >
                    {STATUS_TEXT[c.status]}
                  </span>
                  <a href={`/app/c/${c.token}`} className="text-gold hover:underline">
                    {c.status === "collecting" && !c.youSigned ? "Review & sign →" : "Open →"}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
