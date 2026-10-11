/// Brings a chain index up to date from the chain with `eth_getLogs` over fixed block ranges, the
/// same way the protocol stats indexer does (`src/stats/indexer.ts`).
///
/// - Each chunk's events and nonces are written before the cursor moves. A crash re-reads the
///   chunk and rewrites the same fields, so nothing is counted twice.
/// - It reads only up to `head - confirmations`.
/// - A run stops at its time budget with its progress saved, and the next run carries on.
/// - An undecodable Registry log throws and leaves the cursor where it was.

import type { StatsRpc } from "../stats/indexer";
import { STATS_CHUNK_BLOCKS } from "../stats/indexer";
import { pairKey, parseRegistryLog, type StoredEvent } from "./events";
import type { ChainIndexStore, IndexMeta } from "./store";

/// Arc finalises in under a second; one block of margin is plenty for a nonce.
export const INDEX_CONFIRMATIONS = 1n;
/// Most events kept. Past it the index stops adding and says so (`truncated`); nonces are exact
/// regardless.
export const MAX_INDEXED_EVENTS = 4_000;

export interface IndexContext {
  chainId: number;
  contract: string;
  startBlock: bigint;
  now: () => Date;
  /// Stop starting new chunks after this many ms. The chunk in flight still finishes and is saved.
  budgetMs: number;
  chunkBlocks?: bigint;
  confirmations?: bigint;
  maxEvents?: number;
}

export interface SyncResult {
  meta: IndexMeta;
  chunks: number;
  caughtUp: boolean;
}

export function emptyMeta(ctx: IndexContext): IndexMeta {
  return {
    chainId: ctx.chainId,
    contract: ctx.contract.toLowerCase(),
    startBlock: ctx.startBlock.toString(),
    cursorBlock: (ctx.startBlock - 1n).toString(),
    headBlock: (ctx.startBlock - 1n).toString(),
    updatedAt: ctx.now().toISOString(),
    events: 0,
    truncated: false,
  };
}

export async function syncChainIndex(store: ChainIndexStore, rpc: StatsRpc, ctx: IndexContext): Promise<SyncResult> {
  const started = ctx.now().getTime();
  const chunk = ctx.chunkBlocks ?? STATS_CHUNK_BLOCKS;
  const confirmations = ctx.confirmations ?? INDEX_CONFIRMATIONS;
  const maxEvents = ctx.maxEvents ?? MAX_INDEXED_EVENTS;

  let meta = (await store.getMeta()) ?? emptyMeta(ctx);
  const head = (await rpc.blockNumber()) - confirmations;
  if (head > BigInt(meta.headBlock)) meta = { ...meta, headBlock: head.toString() };

  let chunks = 0;
  while (BigInt(meta.cursorBlock) < head && ctx.now().getTime() - started < ctx.budgetMs) {
    const from = BigInt(meta.cursorBlock) + 1n;
    const to = from + chunk - 1n > head ? head : from + chunk - 1n;
    const logs = await rpc.getLogs([ctx.contract], from, to);

    const events: StoredEvent[] = [];
    for (const log of logs) {
      if (log.removed) throw new Error(`Removed log ${log.transactionHash}#${log.logIndex} inside the confirmed range`);
      if (log.address.toLowerCase() !== ctx.contract.toLowerCase()) continue;
      const event = parseRegistryLog(log);
      if (event) events.push(event);
    }

    // Nonces are exact and never capped: they come from every registered event in the chunk.
    const registered = events.filter((e) => e.k === "R");
    if (registered.length > 0) {
      const pairs = [...new Set(registered.map((e) => pairKey(e.d, e.c)))];
      const known = await store.getNonces(pairs);
      const next = new Map<string, bigint>();
      for (const e of registered) {
        const pair = pairKey(e.d, e.c);
        const current = next.get(pair) ?? known.get(pair) ?? 0n;
        const nonce = BigInt(e.n);
        if (nonce > current) next.set(pair, nonce);
      }
      if (next.size > 0) await store.putNonces(next);
    }

    let truncated = meta.truncated;
    let toStore = events;
    if (events.length > 0) {
      const have = await store.countEvents();
      const room = Math.max(0, maxEvents - have);
      if (events.length > room) {
        toStore = events.slice(0, room);
        truncated = true;
      }
      if (toStore.length > 0) await store.putEvents(toStore);
    }
    const stored = events.length > 0 ? await store.countEvents() : meta.events;

    meta = { ...meta, cursorBlock: to.toString(), events: stored, truncated, updatedAt: ctx.now().toISOString() };
    await store.putMeta(meta);
    chunks++;
  }

  const caughtUp = BigInt(meta.cursorBlock) >= head;
  if (caughtUp) {
    meta = { ...meta, updatedAt: ctx.now().toISOString() };
    await store.putMeta(meta);
  }
  return { meta, chunks, caughtUp };
}
