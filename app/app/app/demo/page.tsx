"use client";

import { useRef, useState } from "react";
import { SiteNav } from "../../../components/site-nav";
import { SiteFooter } from "../../../components/site-footer";
import { Receipt, type ReceiptData } from "../../../components/receipt/Receipt";
import { CycleDiagram, type DemoEdge, type DiagramCenter } from "./CycleDiagram";
import { registerCycleInvoiceStep, proposeCycle, settleProposedCycle } from "./actions";
import { MIN_DEMO_PARTIES, MAX_DEMO_PARTIES, deriveDemoParties } from "../../../src/fixtures/demoIdentities";

const PARTY_COUNT_OPTIONS = Array.from(
  { length: MAX_DEMO_PARTIES - MIN_DEMO_PARTIES + 1 },
  (_, i) => MIN_DEMO_PARTIES + i,
);

function idleEdgesFor(partyCount: number): DemoEdge[] {
  const parties = deriveDemoParties("preview", partyCount);
  return parties.map((p, i) => ({
    fromLabel: p.label,
    toLabel: parties[(i + 1) % partyCount]!.label,
    status: "pending" as const,
  }));
}

type Phase = "idle" | "running" | "readyToSettle" | "settling" | "done";

interface RegisteredRow {
  label: string;
  amountUsdc: string;
  invoiceId: string;
  explorerUrl: string;
}

export default function DemoPage() {
  const [partyCount, setPartyCount] = useState(3);
  const [phase, setPhase] = useState<Phase>("idle");
  const [edges, setEdges] = useState<DemoEdge[]>(idleEdgesFor(3));
  const [center, setCenter] = useState<DiagramCenter>({ kind: "idle" });
  const [registeredRows, setRegisteredRows] = useState<RegisteredRow[]>([]);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingSettleRef = useRef<{ invoiceIds: string[]; labels: Record<string, string> } | null>(null);

  const totalInvoicedUsdc = registeredRows.reduce((sum, r) => sum + Number(r.amountUsdc), 0).toFixed(2);

  function setEdgeStatus(index: number, patch: Partial<DemoEdge>) {
    setEdges((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function selectPartyCount(count: number) {
    setPartyCount(count);
    setEdges(idleEdgesFor(count));
    setCenter({ kind: "idle" });
    setRegisteredRows([]);
    setReceipt(null);
    setError(null);
    setPhase("idle");
  }

  async function runFixture() {
    setError(null);
    setReceipt(null);
    setRegisteredRows([]);
    setEdges(idleEdgesFor(partyCount));
    setCenter({ kind: "idle" });
    setPhase("running");

    const runSalt = crypto.randomUUID();
    const ids: string[] = [];
    const labels: Record<string, string> = {};
    const rows: RegisteredRow[] = [];

    for (let i = 0; i < partyCount; i++) {
      setEdgeStatus(i, { status: "signing" });
      const result = await registerCycleInvoiceStep(runSalt, partyCount, i);
      if (!result.ok) {
        setError(result.error);
        setPhase("idle");
        return;
      }
      ids.push(result.invoice.invoiceId);
      labels[result.invoice.invoiceId] = result.invoice.label;
      rows.push({
        label: result.invoice.label,
        amountUsdc: result.invoice.amountUsdc,
        invoiceId: result.invoice.invoiceId,
        explorerUrl: result.invoice.explorerUrl,
      });
      setRegisteredRows([...rows]);
      setEdgeStatus(i, { status: "registered", amountUsdc: result.invoice.amountUsdc, explorerUrl: result.invoice.explorerUrl });
    }

    setCenter({ kind: "finding" });

    const proposeResult = await proposeCycle(ids);
    if (!proposeResult.ok) {
      setError(proposeResult.error);
      setPhase("idle");
      return;
    }
    if (!proposeResult.proposal) {
      setCenter({ kind: "idle" });
      setError("No settleable cycle right now. Try running the demo again.");
      setPhase("idle");
      return;
    }
    setCenter({ kind: "proposal", wNetUsdc: proposeResult.proposal.wNetUsdc });
    setPhase("readyToSettle");

    // Stashed in a ref (not state) since the settle step needs it but changing it shouldn't
    // trigger a re-render on its own.
    pendingSettleRef.current = { invoiceIds: proposeResult.proposal.invoiceIds, labels };
  }

  async function settle() {
    const pending = pendingSettleRef.current;
    if (!pending) return;

    setError(null);
    setPhase("settling");
    setCenter({ kind: "settling" });
    setEdges((prev) => prev.map((e) => ({ ...e, status: "settling" as const })));

    const result = await settleProposedCycle(pending.invoiceIds, pending.labels);
    if (!result.ok) {
      setError(result.error);
      setPhase("readyToSettle");
      return;
    }

    setEdges((prev) => prev.map((e) => ({ ...e, status: "settled" as const, explorerUrl: result.result.explorerUrl })));
    setCenter({ kind: "settled", grossCancelledUsdc: result.result.grossCancelledUsdc });
    setReceipt(result.result);
    setPhase("done");
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-3xl px-6 pb-10 pt-10">
          <span className="inline-flex items-center gap-2 rounded-pill border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold">
            DEMO
          </span>
          <h1 className="mt-4 font-serif-display text-4xl leading-[1.05]">
            Watch a cycle cancel, live
          </h1>
          <p className="mt-4 text-muted">
            This runs for real on Arc testnet. To let you see the whole flow without other real
            people, we sign every side ourselves with keys held server-side — the parties below
            aren't real companies. Everything after that — registering, finding the cycle, and
            settling it — happens exactly as it would for anyone.
          </p>
          <p className="mt-3 text-muted">
            Each invoice owes a different amount, on purpose — settling reduces every invoice in
            the cycle by the same figure, so only the smallest one fully clears. The rest keep a
            real remaining balance, visible in the receipt below.
          </p>
          <p className="mt-3 rounded-card border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-muted">
            Arc Testnet · chain id 5042002 — gas is native USDC, invoices are ERC-20 USDC.
          </p>
        </section>

        <section className="mx-auto max-w-2xl px-6 pb-20">
          <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 sm:p-10">
            {phase === "idle" && (
              <div className="mb-8 flex flex-col items-center gap-3">
                <p className="text-xs uppercase tracking-wide text-muted">Cycle size</p>
                <div className="flex gap-2">
                  {PARTY_COUNT_OPTIONS.map((count) => (
                    <button
                      key={count}
                      onClick={() => selectPartyCount(count)}
                      className={`rounded-pill border px-4 py-1.5 text-sm transition-colors ${
                        count === partyCount ? "border-gold bg-gold/10 text-gold" : "border-white/15 text-muted hover:border-white/30"
                      }`}
                    >
                      {count} parties
                    </button>
                  ))}
                </div>
                <p className="text-center text-xs text-muted">
                  Arc's settle() supports 3–5-party cycles — {MIN_DEMO_PARTIES} to {MAX_DEMO_PARTIES} is the real on-chain range, not a UI limit.
                </p>
              </div>
            )}

            <CycleDiagram edges={edges} center={center} />

            <div className="mt-8 flex flex-col items-center gap-4">
              {phase === "idle" && (
                <button
                  onClick={runFixture}
                  className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
                >
                  Run the demo
                </button>
              )}
              {phase === "running" && <p className="text-sm text-muted">Registering invoices on-chain...</p>}
              {phase === "readyToSettle" && (
                <>
                  <p className="text-center text-sm text-muted">
                    {registeredRows.length} invoices, totaling ${totalInvoicedUsdc} — settling reduces
                    every one of them by the same amount.
                  </p>
                  <button
                    onClick={settle}
                    className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
                  >
                    Settle this cycle
                  </button>
                </>
              )}
              {phase === "settling" && <p className="text-sm text-muted">Settling on-chain...</p>}
              {phase === "done" && (
                <button
                  onClick={runFixture}
                  className="rounded-pill border border-white/15 px-6 py-3 text-sm font-medium hover:border-white/30"
                >
                  Run it again
                </button>
              )}

              {error && (
                <p className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
                  {error}
                </p>
              )}
            </div>

            {registeredRows.length > 0 && (
              <div className="mt-8 border-t border-white/10 pt-6">
                <p className="text-xs uppercase tracking-wide text-muted">Registered, one at a time</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {registeredRows.map((row) => (
                    <li key={row.invoiceId} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted">
                        {row.label} <span className="text-foreground/70">· ${row.amountUsdc}</span>
                      </span>
                      <a href={row.explorerUrl} target="_blank" rel="noreferrer" className="text-gold hover:underline">
                        View transaction →
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {receipt && (
            <div className="mt-6">
              <Receipt data={receipt} />
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
