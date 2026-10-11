/// Production wiring for the chain index, and the readers the two-party invoice flow uses in place
/// of the block explorer. Server-only.
///
/// Readers fail closed: when the index can't be brought up to the head within the budget they throw
/// `ChainIndexBehindError`, and each caller reports "unknown" or "incomplete", never a guess.

import { logsRpcUrlsFor } from "../chain/rpc";
import type { DecodedLog } from "../blockscout/client";
import { addressesForChain } from "../contracts/addresses";
import type { StatsRpc } from "../stats/indexer";
import { createStatsRpc } from "../stats/rpc";
import { pairKey, toDecodedLog } from "./events";
import { syncChainIndex, type IndexContext } from "./indexer";
import { redisChainIndexStore, type ChainIndexStore, type IndexMeta } from "./store";

export class ChainIndexBehindError extends Error {
  constructor(message = "The chain index is not caught up yet") {
    super(message);
    this.name = "ChainIndexBehindError";
  }
}

/// How long a reader may spend bringing the index up to the head.
export const READ_BUDGET_MS = 5_000;
/// An index checked against the head this recently is used without another RPC call.
const FRESH_MS = 3_000;
/// The background refresh leaves an index alone when it was checked this recently.
export const WARM_WITHIN_MS = 20_000;
export const BACKGROUND_BUDGET_MS = 3_000;
const LOCK_WAIT_STEP_MS = 400;

export interface IndexDeps {
  store: ChainIndexStore;
  rpc: StatsRpc;
  context: Omit<IndexContext, "budgetMs">;
  sleep?: (ms: number) => Promise<void>;
}

export function productionIndexDeps(chainId: number): IndexDeps {
  const { registry, registryDeployBlock } = addressesForChain(chainId);
  return {
    store: redisChainIndexStore(chainId, registry),
    rpc: createStatsRpc(logsRpcUrlsFor(chainId)),
    context: { chainId, contract: registry, startBlock: registryDeployBlock, now: () => new Date() },
  };
}

function isCaughtUp(meta: IndexMeta | null): meta is IndexMeta {
  return meta !== null && BigInt(meta.cursorBlock) >= BigInt(meta.headBlock) && BigInt(meta.headBlock) >= BigInt(meta.startBlock);
}

function isFresh(meta: IndexMeta | null, now: Date, withinMs: number): meta is IndexMeta {
  return isCaughtUp(meta) && now.getTime() - Date.parse(meta.updatedAt) < withinMs;
}

/// Returns the index metadata once the index is at the confirmed head, or throws.
export async function ensureIndexed(deps: IndexDeps, budgetMs = READ_BUDGET_MS): Promise<IndexMeta> {
  const { store, rpc, context } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = context.now().getTime() + budgetMs;

  for (;;) {
    const meta = await store.getMeta().catch((e) => {
      throw new ChainIndexBehindError(`The chain index could not be read: ${e instanceof Error ? e.message : String(e)}`);
    });
    if (isFresh(meta, context.now(), FRESH_MS)) return meta;

    const remaining = deadline - context.now().getTime();
    if (remaining <= 0) throw new ChainIndexBehindError();

    const release = await store.lock(Math.ceil(budgetMs / 1000) + 60).catch(() => null);
    if (release) {
      try {
        const result = await syncChainIndex(store, rpc, { ...context, budgetMs: remaining });
        if (result.caughtUp) return result.meta;
      } catch (e) {
        throw new ChainIndexBehindError(`The chain index could not be updated: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await release().catch((e) => console.error("Releasing the chain index lock failed (it expires on its own):", e));
      }
      throw new ChainIndexBehindError();
    }
    // Another run is syncing: wait for its result rather than reading the same ranges twice.
    await sleep(LOCK_WAIT_STEP_MS);
  }
}

/// The largest nonce registered for the pair, plus one: what `register()` will accept next.
export async function indexedNextNonce(chainId: number, debtor: string, creditor: string, deps?: IndexDeps): Promise<bigint> {
  const d = deps ?? productionIndexDeps(chainId);
  await ensureIndexed(d);
  const pair = pairKey(debtor, creditor);
  const found = await d.store.getNonces([pair]);
  return (found.get(pair) ?? 0n) + 1n;
}

export interface IndexedLogs {
  /// Newest first, like the explorer's list.
  logs: DecodedLog[];
  truncated: boolean;
}

export async function indexedRegistryLogs(chainId: number, deps?: IndexDeps): Promise<IndexedLogs> {
  const d = deps ?? productionIndexDeps(chainId);
  const meta = await ensureIndexed(d);
  const events = await d.store.allEvents();
  const registry = d.context.contract;
  return { logs: events.reverse().map((event) => toDecodedLog(event, registry)), truncated: meta.truncated };
}

export interface IndexProgress {
  cursorBlock: string;
  headBlock: string;
  caughtUp: boolean;
}

/// Advances the index when it hasn't been checked lately, without ever blocking or throwing. Run
/// from a background hook (`after()`), where a reader isn't waiting. Null when it did nothing or
/// couldn't run; otherwise how far the index has got.
export async function advanceChainIndexQuietly(
  chainId: number,
  deps?: IndexDeps,
  budgetMs = BACKGROUND_BUDGET_MS,
): Promise<IndexProgress | null> {
  try {
    const d = deps ?? productionIndexDeps(chainId);
    const meta = await d.store.getMeta();
    if (isFresh(meta, d.context.now(), WARM_WITHIN_MS)) return null;
    const release = await d.store.lock(Math.ceil(budgetMs / 1000) + 60);
    if (!release) return null;
    try {
      const { meta: next, caughtUp } = await syncChainIndex(d.store, d.rpc, { ...d.context, budgetMs });
      return { cursorBlock: next.cursorBlock, headBlock: next.headBlock, caughtUp };
    } finally {
      await release().catch((e) => console.error("Releasing the chain index lock failed (it expires on its own):", e));
    }
  } catch (error) {
    console.error("Chain index refresh failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
