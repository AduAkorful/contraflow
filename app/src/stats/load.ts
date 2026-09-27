/// Server-only: serves protocol stats from Upstash, bringing them up to date from the explorer at
/// most once a minute. Stored stats are never dropped because a refresh failed: an older figure
/// with its real "as of" time is true, a zero is not.

import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { fetchContractLogsSince, fetchTransactionSummary } from "../blockscout/client";
import { operatorAddress } from "../chain/operatorEnv";
import { redis } from "../upstash/client";
import type { StatsState } from "./aggregate";
import { updateStats, type IndexerContext, type IndexerDeps } from "./indexer";

/// Switches to mainnet with the mainnet deploy, like the rest of the app.
export const STATS_CHAIN_ID = ARC_TESTNET_CHAIN_ID;
/// Bump whenever `StatsState`'s shape or any counting rule changes, so the next request rebuilds.
const STATS_VERSION = "v1";
const FRESH_MS = 60_000;
/// A periodic full rebuild catches anything an incremental refresh could have missed.
const REBUILD_MS = 24 * 60 * 60 * 1000;
const LOCK_SECONDS = 30;

export class StatsUnavailableError extends Error {
  constructor(reason: string) {
    super(`Protocol stats unavailable: ${reason}`);
  }
}

export interface StatsStore {
  get(): Promise<StatsState | null>;
  set(state: StatsState): Promise<void>;
  /// False when another request already holds the lock.
  lock(): Promise<boolean>;
  unlock(): Promise<void>;
}

/// Returns the freshest state it can. Throws `StatsUnavailableError` only when there's no stored
/// state at all and none could be built.
export async function loadStats(
  store: StatsStore,
  update: (previous: StatsState | null) => Promise<StatsState>,
  now: Date,
): Promise<StatsState> {
  const stored = await store.get();
  const age = stored ? now.getTime() - Date.parse(stored.updatedAt) : Infinity;
  if (stored && age < FRESH_MS) return stored;

  if (!(await store.lock())) {
    if (stored) return stored;
    throw new StatsUnavailableError("a first build is already running");
  }

  try {
    const needsRebuild = !stored || now.getTime() - Date.parse(stored.builtAt) >= REBUILD_MS;
    const next = await update(needsRebuild ? null : stored);
    if (next.undecoded > (stored?.undecoded ?? 0)) {
      console.warn(`Protocol stats skipped ${next.undecoded} undecoded contract logs`);
    }
    await store.set(next);
    return next;
  } catch (error) {
    if (stored) return stored;
    throw new StatsUnavailableError(error instanceof Error ? error.message : String(error));
  } finally {
    await store.unlock().catch(() => {
      // The lock expires on its own after LOCK_SECONDS.
    });
  }
}

function redisStore(chainId: number): StatsStore {
  const key = `stats:${STATS_VERSION}:${chainId}`;
  const lockKey = `${key}:lock`;
  return {
    get: () => redis().get<StatsState>(key),
    set: async (state) => {
      await redis().set(key, state);
    },
    lock: async () => (await redis().set(lockKey, "1", { nx: true, ex: LOCK_SECONDS })) === "OK",
    unlock: async () => {
      await redis().del(lockKey);
    },
  };
}

export async function getProtocolStats(): Promise<StatsState> {
  const operator = operatorAddress();
  // Without the operator address, demo activity would be counted as real usage.
  if (!operator) throw new StatsUnavailableError("operator address not configured");

  const { registry, settler, nettingLedger } = addressesForChain(STATS_CHAIN_ID);
  const now = new Date();
  const ctx: IndexerContext = {
    chainId: STATS_CHAIN_ID,
    contracts: { registry, settler, ledger: nettingLedger },
    operators: new Set([operator.toLowerCase()]),
    now: now.toISOString(),
  };
  const deps: IndexerDeps = {
    fetchLogs: (contract, since, maxPages) => fetchContractLogsSince(STATS_CHAIN_ID, contract, since, maxPages),
    fetchTransaction: (txHash) => fetchTransactionSummary(STATS_CHAIN_ID, txHash),
  };
  return loadStats(redisStore(STATS_CHAIN_ID), (previous) => updateStats(previous, ctx, deps), now);
}
