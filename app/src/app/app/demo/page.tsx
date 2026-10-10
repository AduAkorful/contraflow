"use client";

import { useRef, useState } from "react";
import { Receipt, type ReceiptData } from "@/components/receipt/Receipt";
import { Money } from "@/components/ui/Money";
import { sumUsdc } from "@/src/format/money";
import { CycleDiagram } from "./CycleDiagram";
import { registerCycleInvoiceStep, proposeCycle, settleProposedCycle } from "./actions";
import { MIN_DEMO_PARTIES, MAX_DEMO_PARTIES } from "@/src/fixtures/demoIdentities";
import {
  afterSettleFailure,
  demoIdleEdges,
  demoLeadSentence,
  type DemoCenterView,
  type DemoEdgeView,
  type DemoPhase,
} from "@/src/demo/pageState";

const PARTY_COUNT_OPTIONS = Array.from(
  { length: MAX_DEMO_PARTIES - MIN_DEMO_PARTIES + 1 },
  (_, i) => MIN_DEMO_PARTIES + i,
);

/// Idle amounts are a stable preview (hydration-safe). The live run generates its own salt.
const PREVIEW_SALT = "preview";

interface RegisteredRow {
  label: string;
  amountUsdc: string;
  invoiceId: string;
  explorerUrl: string;
}

export default function DemoPage() {
  const [partyCount, setPartyCount] = useState(3);
  const [runSalt, setRunSalt] = useState(PREVIEW_SALT);
  const [phase, setPhase] = useState<DemoPhase>("idle");
  const [edges, setEdges] = useState<DemoEdgeView[]>(demoIdleEdges(PREVIEW_SALT, 3));
  const [center, setCenter] = useState<DemoCenterView>({ kind: "idle" });
  const [registeredRows, setRegisteredRows] = useState<RegisteredRow[]>([]);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingSettleRef = useRef<{ runSalt: string; invoiceIds: string[]; labels: Record<string, string> } | null>(null);
  const settleInFlightRef = useRef(false);

  const totalInvoicedUsdc = sumUsdc(registeredRows.map((r) => r.amountUsdc));

  function setEdgeStatus(index: number, patch: Partial<DemoEdgeView>) {
    setEdges((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function resetToIdle(count: number) {
    pendingSettleRef.current = null;
    settleInFlightRef.current = false;
    setPartyCount(count);
    setRunSalt(PREVIEW_SALT);
    setEdges(demoIdleEdges(PREVIEW_SALT, count));
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
    settleInFlightRef.current = false;
    const nextSalt = crypto.randomUUID();
    setRunSalt(nextSalt);
    setEdges(demoIdleEdges(nextSalt, partyCount));
    setCenter({ kind: "idle" });
    setPhase("running");

    const runSalt = nextSalt;
    const ids: string[] = [];
    const labels: Record<string, string> = {};
    const rows: RegisteredRow[] = [];
    pendingSettleRef.current = { runSalt, invoiceIds: [], labels };

    for (let i = 0; i < partyCount; i++) {
      setEdgeStatus(i, { status: "signing", amountUsdc: undefined, explorerUrl: undefined });
      const result = await registerCycleInvoiceStep(runSalt, partyCount, i);
      if (!result.ok) {
        setError(result.error);
        pendingSettleRef.current = null;
        setRunSalt(PREVIEW_SALT);
        setEdges(demoIdleEdges(PREVIEW_SALT, partyCount));
        setCenter({ kind: "idle" });
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
      pendingSettleRef.current = null;
      setRunSalt(PREVIEW_SALT);
      setPhase("idle");
      return;
    }
    if (!proposeResult.proposal) {
      setCenter({ kind: "idle" });
      setError("No settleable cycle right now. Try running the demo again.");
      pendingSettleRef.current = null;
      setRunSalt(PREVIEW_SALT);
      setPhase("idle");
      return;
    }
    setCenter({ kind: "proposal", wNetUsdc: proposeResult.proposal.wNetUsdc });
    setPhase("readyToSettle");
    pendingSettleRef.current = { runSalt, invoiceIds: proposeResult.proposal.invoiceIds, labels };
  }

  async function settle() {
    const pending = pendingSettleRef.current;
    if (!pending || settleInFlightRef.current || phase === "settleFailed") return;
    settleInFlightRef.current = true;
    const edgesWhenSettling = edges;

    setError(null);
    setPhase("settling");
    setCenter({ kind: "settling" });
    setEdges((prev) => prev.map((e) => ({ ...e, status: "settling" as const })));

    const result = await settleProposedCycle(pending.runSalt, pending.invoiceIds, pending.labels);
    if (!result.ok) {
      const failed = afterSettleFailure(edgesWhenSettling);
      setEdges(failed.edges);
      setCenter(failed.center);
      setPhase(failed.phase);
      setError(result.error);
      settleInFlightRef.current = false;
      return;
    }

    setEdges((prev) => prev.map((e) => ({ ...e, status: "settled" as const, explorerUrl: result.result.explorerUrl })));
    setCenter({ kind: "settled", grossCancelledUsdc: result.result.grossCancelledUsdc });
    setReceipt(result.result);
    setPhase("done");
    settleInFlightRef.current = false;
  }

  return (
    <>
      <section className="mx-auto max-w-3xl px-6 pb-6 pt-10">
        <span className="inline-flex items-center gap-2 rounded-pill border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold">
          DEMO
        </span>
        <h1 className="mt-4 heading-1">
          Watch a cycle cancel, live
        </h1>
        <p className="mt-4 text-muted">
          {demoLeadSentence(partyCount, runSalt)}
        </p>
      </section>

      <section className="mx-auto max-w-2xl px-6 pb-20">
        <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 sm:p-8">
          {phase === "idle" && (
            <div className="mb-6 flex flex-col items-center gap-3">
              <p className="text-xs uppercase tracking-wide text-muted">Cycle size</p>
              <div className="flex gap-2">
                {PARTY_COUNT_OPTIONS.map((count) => (
                  <button
                    key={count}
                    onClick={() => resetToIdle(count)}
                    className={`rounded-pill border px-4 py-1.5 text-sm transition-colors ${
                      count === partyCount ? "border-gold bg-gold/10 text-gold" : "border-white/15 text-muted hover:border-white/30"
                    }`}
                  >
                    {count} parties
                  </button>
                ))}
              </div>
              <p className="text-center text-xs text-muted">
                Invoice loops settle with {MIN_DEMO_PARTIES} to {MAX_DEMO_PARTIES} parties.
              </p>
            </div>
          )}

          {phase === "idle" && (
            <div className="mb-6 flex flex-col items-center">
              <button
                onClick={runFixture}
                className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
              >
                Run the demo
              </button>
            </div>
          )}

          <CycleDiagram edges={edges} center={center} />

          <div className="mt-6 flex flex-col items-center gap-4">
            {phase === "running" && <p className="text-sm text-muted">Registering invoices on Arc...</p>}
            {phase === "readyToSettle" && (
              <>
                <p className="text-center text-sm text-muted">
                  {registeredRows.length} invoices, totaling <Money value={totalInvoicedUsdc} /> — settling reduces
                  every one of them by the same amount.
                </p>
                {center.kind === "proposal" && (
                  <p className="text-center text-sm text-muted">
                    Net to settle: <Money value={center.wNetUsdc} />
                  </p>
                )}
                <button
                  onClick={settle}
                  className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
                >
                  Settle this cycle
                </button>
              </>
            )}
            {phase === "settling" && <p className="text-sm text-muted">Settling on Arc...</p>}
            {phase === "settleFailed" && (
              <>
                <button
                  disabled
                  className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black disabled:state-disabled"
                >
                  Settle this cycle
                </button>
                <button
                  onClick={() => resetToIdle(partyCount)}
                  className="rounded-pill border border-border-input px-6 py-3 text-sm font-medium hover:border-white/30"
                >
                  Reset demo
                </button>
              </>
            )}
            {phase === "done" && (
              <button
                onClick={runFixture}
                className="rounded-pill border border-border-input px-6 py-3 text-sm font-medium hover:border-white/30"
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

          <details className="mt-8 rounded-card border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-muted">
            <summary className="cursor-pointer text-foreground">How this demo works</summary>
            <p className="mt-3">
              This runs for real on Arc testnet. To let you see the whole flow without other real
              people, we sign every side ourselves with keys held server-side — the parties below
              aren&apos;t real companies. Everything after that — registering, finding the cycle, and
              settling it — happens exactly as it would for anyone.
            </p>
            <p className="mt-3">
              Each invoice owes a different amount, on purpose — settling reduces every invoice in
              the cycle by the same figure, so only the smallest one fully clears. The rest keep a
              real remaining balance, visible in the receipt below.
            </p>
            <p className="mt-3 text-xs">
              Arc Testnet · chain id 5042002 — gas is native USDC, invoices are ERC-20 USDC.
            </p>
          </details>

          {registeredRows.length > 0 && (
            <div className="mt-8 border-t border-white/10 pt-6">
              <p className="text-xs uppercase tracking-wide text-muted">Registered, one at a time</p>
              <ul className="mt-3 space-y-2 text-sm">
                {registeredRows.map((row) => (
                  <li key={row.invoiceId} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted">
                      {row.label} <span className="text-foreground/70">· <Money value={row.amountUsdc} /></span>
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
    </>
  );
}
