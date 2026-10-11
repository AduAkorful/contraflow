/// Brings a `StatsState` up to date from the chain with `eth_getLogs` over fixed block ranges.
///
/// - The cursor is a block number. Each chunk's logs are folded and the state (totals and cursor
///   together) is saved before the next chunk, so a crash or timeout loses at most the chunk in
///   flight, which the next run reads again from the saved cursor. Nothing is counted twice:
///   `foldEvents` skips blocks at or below the cursor and duplicate log ids.
/// - It only reads up to `head - confirmations`, so a counted log is final.
/// - There's no page cap: a run stops at its time budget with the cursor saved, and the next run
///   carries on. The view says "catching up" until the cursor reaches the head.

import { emptyState, foldEvents, type StatsState } from "./aggregate";
import { parseStatsEvent, type RawLog, type StatsContract, type StatsEvent } from "./events";

/// Arc's public RPC rejects `eth_getLogs` ranges of 10,000 blocks or more.
export const STATS_CHUNK_BLOCKS = 9_999n;
export const STATS_CONFIRMATIONS = 3n;
/// Ranges fetched per batch, one at a time: the public Arc RPC answers HTTP 429 to parallel
/// `eth_getLogs` calls but serves about four sequential 10,000-block ranges a second.
const FETCH_CONCURRENCY = 1;

export interface StatsRpc {
  blockNumber(): Promise<bigint>;
  /// Every log any of `addresses` emitted in [fromBlock, toBlock], inclusive.
  getLogs(addresses: string[], fromBlock: bigint, toBlock: bigint): Promise<RawLog[]>;
}

export interface IndexerContext {
  chainId: number;
  contracts: Record<StatsContract, string>;
  startBlock: bigint;
  now: () => Date;
  /// Stop starting new chunks after this many ms. The chunk in flight still finishes and is saved.
  budgetMs: number;
  chunkBlocks?: bigint;
  confirmations?: bigint;
}

export interface RefreshResult {
  state: StatsState;
  chunks: number;
  caughtUp: boolean;
}

function contractOf(address: string, contracts: Record<StatsContract, string>): StatsContract | null {
  const lower = address.toLowerCase();
  for (const [name, a] of Object.entries(contracts) as [StatsContract, string][]) {
    if (a.toLowerCase() === lower) return name;
  }
  return null;
}

export function decodeChunk(logs: RawLog[], contracts: Record<StatsContract, string>): StatsEvent[] {
  const events: StatsEvent[] = [];
  for (const log of logs) {
    if (log.removed) throw new Error(`Removed log ${log.transactionHash}#${log.logIndex} inside the confirmed range`);
    const contract = contractOf(log.address, contracts);
    if (!contract) continue;
    const event = parseStatsEvent(contract, log);
    if (event) events.push(event);
  }
  return events.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}

/// Runs chunks from the saved cursor towards the confirmed head, calling `save` after every chunk.
export async function refreshStats(
  previous: StatsState | null,
  ctx: IndexerContext,
  rpc: StatsRpc,
  save: (state: StatsState) => Promise<void>,
): Promise<RefreshResult> {
  const started = ctx.now().getTime();
  const chunk = ctx.chunkBlocks ?? STATS_CHUNK_BLOCKS;
  const confirmations = ctx.confirmations ?? STATS_CONFIRMATIONS;
  const addresses = Object.values(ctx.contracts);

  let state = previous ?? emptyState(ctx.chainId, ctx.startBlock, ctx.now().toISOString());
  const head = (await rpc.blockNumber()) - confirmations;
  if (head > BigInt(state.headBlock)) state = { ...state, headBlock: head.toString() };

  let chunks = 0;
  while (BigInt(state.cursorBlock) < head && ctx.now().getTime() - started < ctx.budgetMs) {
    // Fetch the next range(s), then fold and save them strictly in order.
    const ranges: [bigint, bigint][] = [];
    let from = BigInt(state.cursorBlock) + 1n;
    while (ranges.length < FETCH_CONCURRENCY && from <= head) {
      const to = from + chunk - 1n > head ? head : from + chunk - 1n;
      ranges.push([from, to]);
      from = to + 1n;
    }
    const results = await Promise.allSettled(ranges.map(([f, t]) => rpc.getLogs(addresses, f, t)));
    for (let i = 0; i < ranges.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") throw result.reason;
      const [, to] = ranges[i]!;
      const folded = foldEvents(state, decodeChunk(result.value, ctx.contracts));
      state = { ...folded, cursorBlock: to.toString() };
      await save(state);
      chunks++;
    }
  }

  const caughtUp = BigInt(state.cursorBlock) >= head;
  if (caughtUp) {
    state = { ...state, updatedAt: ctx.now().toISOString() };
    await save(state);
  }
  return { state, chunks, caughtUp };
}
