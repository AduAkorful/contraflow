/// Brings a `StatsState` up to date from the explorer. A refresh reads only logs after each
/// contract's cursor; a rebuild starts from nothing. Arc has deterministic finality, so a counted
/// log is never reorged away and the cursor never needs to trail the head.

import type { LogPosition, LogsSince, TransactionSummary } from "../blockscout/client";
import { emptyState, foldEvents, type AttributedEvent, type StatsState } from "./aggregate";
import { parseStatsEvent, type StatsContract } from "./events";

/// 50 logs a page, so up to 2,000 logs per contract on a full rebuild. Past that the totals are
/// marked as lower bounds rather than presented as exact.
export const STATS_MAX_PAGES = 40;

const CONTRACTS: StatsContract[] = ["registry", "settler", "ledger"];
/// Parallel transaction lookups, kept small so a rebuild doesn't trip the explorer's rate limit.
const TX_LOOKUP_CONCURRENCY = 4;

export interface IndexerDeps {
  fetchLogs(contract: string, since: LogPosition | null, maxPages: number): Promise<LogsSince>;
  fetchTransaction(txHash: string): Promise<TransactionSummary>;
}

export interface IndexerContext {
  chainId: number;
  contracts: Record<StatsContract, string>;
  /// Lowercased.
  operators: ReadonlySet<string>;
  now: string;
}

async function lookupTransactions(hashes: string[], deps: IndexerDeps): Promise<Map<string, TransactionSummary>> {
  const found = new Map<string, TransactionSummary>();
  for (let i = 0; i < hashes.length; i += TX_LOOKUP_CONCURRENCY) {
    const batch = hashes.slice(i, i + TX_LOOKUP_CONCURRENCY);
    const summaries = await Promise.all(batch.map(async (hash) => [hash, await deps.fetchTransaction(hash)] as const));
    for (const [hash, summary] of summaries) found.set(hash, summary);
  }
  return found;
}

/// Full rebuild when `previous` is null. A refresh whose gap is too large to page through falls back
/// to a full rebuild, because skipping the gap would silently undercount.
export async function updateStats(previous: StatsState | null, ctx: IndexerContext, deps: IndexerDeps): Promise<StatsState> {
  const rebuild = previous === null;
  const fetched = {} as Record<StatsContract, LogsSince>;

  for (const contract of CONTRACTS) {
    const since = rebuild ? null : previous.cursors[contract];
    const result = await deps.fetchLogs(ctx.contracts[contract], since, STATS_MAX_PAGES);
    if (!rebuild && result.truncated) return updateStats(null, ctx, deps);
    fetched[contract] = result;
  }

  const parsed = CONTRACTS.flatMap((contract) =>
    fetched[contract].logs.map((log) => parseStatsEvent(contract, log)),
  ).filter((event) => event !== null);

  const transactions = await lookupTransactions([...new Set(parsed.map((e) => e.transactionHash))], deps);
  const attributed: AttributedEvent[] = parsed.map((event) => ({ event, tx: transactions.get(event.transactionHash)! }));

  const base = rebuild ? emptyState(ctx.chainId, ctx.now) : previous;
  const folded = foldEvents(base, attributed, ctx.operators);

  const cursors = { ...base.cursors };
  for (const contract of CONTRACTS) cursors[contract] = fetched[contract].newest ?? base.cursors[contract];

  return {
    ...folded,
    cursors,
    lowerBound: rebuild ? CONTRACTS.some((c) => fetched[c].truncated) : base.lowerBound,
    undecoded: base.undecoded + CONTRACTS.reduce((sum, c) => sum + fetched[c].undecoded, 0),
    updatedAt: ctx.now,
  };
}
