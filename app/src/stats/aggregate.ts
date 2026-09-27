/// Pure fold from contract events to protocol totals. No IO, so every rule here is unit-testable.
///
/// Anything sent by the operator key is Contraflow's own activity: `/app/demo` registers and settles
/// with it, and so do deploy smoke tests, while real parties submit their own transactions. It's
/// kept out of the headline totals and only counted in `demo`, so it never reads as real usage.

import type { LogPosition, TransactionSummary } from "../blockscout/client";
import type { StatsContract, StatsEvent } from "./events";

export interface StatsTotals {
  invoicesRegistered: number;
  /// ERC-20 USDC base units (6 decimals), as a decimal string.
  faceValueRegistered: string;
  /// ERC-20 USDC base units (6 decimals). Equals sum(wNet × cycleLength) over settles.
  valueNetted: string;
  fullyNetted: number;
  invoiceLoopsSettled: number;
  certificatesApplied: number;
  obligationUpdates: number;
  /// Native USDC wei (18 decimals) spent on settle and certificate transactions.
  gasPaidWei: string;
}

export interface DemoTotals {
  invoicesRegistered: number;
  loopsSettled: number;
}

export interface StatsState {
  chainId: number;
  cursors: Record<StatsContract, LogPosition | null>;
  totals: StatsTotals;
  demo: DemoTotals;
  /// Lowercased, sorted. Counted, never shown.
  parties: string[];
  /// Earliest counted (non-demo) event.
  firstEventAt: string | null;
  /// A full rebuild hit the page cap, so every total is a lower bound until the next full rebuild.
  lowerBound: boolean;
  undecoded: number;
  builtAt: string;
  updatedAt: string;
}

export interface AttributedEvent {
  event: StatsEvent;
  tx: TransactionSummary;
}

export function emptyState(chainId: number, now: string): StatsState {
  return {
    chainId,
    cursors: { registry: null, settler: null, ledger: null },
    totals: {
      invoicesRegistered: 0,
      faceValueRegistered: "0",
      valueNetted: "0",
      fullyNetted: 0,
      invoiceLoopsSettled: 0,
      certificatesApplied: 0,
      obligationUpdates: 0,
      gasPaidWei: "0",
    },
    demo: { invoicesRegistered: 0, loopsSettled: 0 },
    parties: [],
    firstEventAt: null,
    lowerBound: false,
    undecoded: 0,
    builtAt: now,
    updatedAt: now,
  };
}

function add(a: string, b: bigint): string {
  return (BigInt(a) + b).toString();
}

/// `operators` must be lowercased.
export function foldEvents(state: StatsState, events: AttributedEvent[], operators: ReadonlySet<string>): StatsState {
  const totals = { ...state.totals };
  const demo = { ...state.demo };
  const parties = new Set(state.parties);
  let firstEventAt = state.firstEventAt;

  for (const { event, tx } of events) {
    if (operators.has(tx.from.toLowerCase())) {
      if (event.kind === "registered") demo.invoicesRegistered++;
      if (event.kind === "settled" || event.kind === "certificateApplied") demo.loopsSettled++;
      continue;
    }

    if (firstEventAt === null || event.blockTimestamp < firstEventAt) firstEventAt = event.blockTimestamp;

    switch (event.kind) {
      case "registered":
        totals.invoicesRegistered++;
        totals.faceValueRegistered = add(totals.faceValueRegistered, event.amount);
        parties.add(event.debtor.toLowerCase());
        parties.add(event.creditor.toLowerCase());
        break;
      case "netted":
        totals.valueNetted = add(totals.valueNetted, event.wNet);
        if (event.fullyNetted) totals.fullyNetted++;
        break;
      case "settled":
        totals.invoiceLoopsSettled++;
        totals.gasPaidWei = add(totals.gasPaidWei, BigInt(tx.feeWei));
        break;
      case "certificateApplied":
        totals.certificatesApplied++;
        totals.gasPaidWei = add(totals.gasPaidWei, BigInt(tx.feeWei));
        break;
      case "obligationAdvanced":
        totals.obligationUpdates++;
        break;
    }
  }

  return { ...state, totals, demo, parties: [...parties].sort(), firstEventAt };
}
