/// Pure fold from contract events to protocol totals. No IO, so every rule here is unit-testable.
///
/// Every event counts, whoever sent it (operator, 2026-10-11): the totals are exactly what the
/// three contracts emitted, which anyone can recount from the chain.

import type { StatsEvent } from "./events";

export interface StatsTotals {
  invoicesRegistered: number;
  /// ERC-20 USDC base units (6 decimals), as a decimal string.
  faceValueRegistered: string;
  /// ERC-20 USDC base units (6 decimals). Sum of `InvoiceNetted.wNet`.
  valueNetted: string;
  fullyNetted: number;
  invoiceLoopsSettled: number;
  certificatesApplied: number;
  obligationUpdates: number;
}

export interface StatsState {
  chainId: number;
  /// First block scanned (the earliest deployment block of the three contracts).
  startBlock: string;
  /// Last block whose logs are fully counted, inclusive. `startBlock - 1` before the first chunk.
  cursorBlock: string;
  /// Newest confirmed block seen by the last refresh. `cursorBlock === headBlock` means caught up.
  headBlock: string;
  totals: StatsTotals;
  /// Lowercased, sorted. Counted, never shown.
  parties: string[];
  /// Earliest counted event, ISO.
  firstEventAt: string | null;
  builtAt: string;
  /// When a refresh last succeeded (reached the head it read). This is the honest "as of".
  updatedAt: string;
}

export function emptyTotals(): StatsTotals {
  return {
    invoicesRegistered: 0,
    faceValueRegistered: "0",
    valueNetted: "0",
    fullyNetted: 0,
    invoiceLoopsSettled: 0,
    certificatesApplied: 0,
    obligationUpdates: 0,
  };
}

export function emptyState(chainId: number, startBlock: bigint, now: string): StatsState {
  return {
    chainId,
    startBlock: startBlock.toString(),
    cursorBlock: (startBlock - 1n).toString(),
    headBlock: (startBlock - 1n).toString(),
    totals: emptyTotals(),
    parties: [],
    firstEventAt: null,
    builtAt: now,
    updatedAt: now,
  };
}

export function isCaughtUp(state: StatsState): boolean {
  return BigInt(state.cursorBlock) >= BigInt(state.headBlock);
}

function add(a: string, b: bigint): string {
  return (BigInt(a) + b).toString();
}

/// Folds events into the state. Events at or below `state.cursorBlock` are already counted and are
/// skipped, and duplicates (same transaction and log index) count once, so replaying a range is safe.
export function foldEvents(state: StatsState, events: StatsEvent[]): StatsState {
  const totals = { ...state.totals };
  const parties = new Set(state.parties);
  let firstEventAt = state.firstEventAt;
  const cursor = BigInt(state.cursorBlock);
  const seen = new Set<string>();

  for (const event of events) {
    if (event.blockNumber <= cursor) continue;
    const key = `${event.transactionHash.toLowerCase()}:${event.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const at = new Date(event.blockTimestamp * 1000).toISOString();
    if (firstEventAt === null || at < firstEventAt) firstEventAt = at;

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
        break;
      case "certificateApplied":
        totals.certificatesApplied++;
        break;
      case "obligationAdvanced":
        totals.obligationUpdates++;
        break;
    }
  }

  return { ...state, totals, parties: [...parties].sort(), firstEventAt };
}
