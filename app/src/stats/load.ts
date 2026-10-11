/// Server-only: protocol stats live precomputed in Upstash. Pages only read them (one GET). They
/// are brought up to date by a small background refresh scheduled with `after()` when a read finds
/// them stale (and by `/api/cron/stats` when something calls it); both take the same lock and save
/// after every chunk.
/// Errors are logged and recorded with the state's real "as of", never hidden behind old figures.

import { addressesForChain, APP_CHAIN_ID } from "../contracts/addresses";
import { redis } from "../upstash/client";
import type { StatsState } from "./aggregate";
import { refreshStats, type RefreshResult, type StatsRpc } from "./indexer";
import { logsRpcUrlsFor } from "../chain/rpc";
import { createStatsRpc } from "./rpc";

/// The chain this deployment serves, like the rest of the app.
export const STATS_CHAIN_ID = APP_CHAIN_ID;
/// Bump whenever `StatsState`'s shape or any counting rule changes; the new key backfills from
/// the deployment block. v2: RPC block cursor, operator activity counted (2026-10-11).
export const STATS_VERSION = "v2";
/// An open page asks every 30 seconds; a read that finds the saved state older than this schedules
/// a small catch-up in the background. Each catch-up is the head block plus one log range.
export const REFRESH_AFTER_MS = 30_000;
/// Time budget that fits Vercel Hobby's default 10-second function limit with room to save.
export const PAGE_VIEW_BUDGET_MS = 3_000;
/// The view flags figures older than this as out of date.
export const STALE_AFTER_MS = 2 * 60_000;

export interface StoredStats {
  state: StatsState | null;
  lastError: { message: string; at: string } | null;
}

export interface StatsStore {
  get(): Promise<StoredStats>;
  set(state: StatsState): Promise<void>;
  setError(message: string, at: string): Promise<void>;
  clearError(): Promise<void>;
  /// Resolves to a release function, or null when another run holds the lock.
  lock(ttlSeconds: number): Promise<(() => Promise<void>) | null>;
}

export function statsKey(chainId: number): string {
  return `stats:${STATS_VERSION}:${chainId}`;
}

export function redisStatsStore(chainId: number): StatsStore {
  const key = statsKey(chainId);
  const errorKey = `${key}:error`;
  const lockKey = `${key}:lock`;
  return {
    get: async () => {
      const [state, lastError] = await Promise.all([
        redis().get<StatsState>(key),
        redis().get<{ message: string; at: string }>(errorKey),
      ]);
      return { state: state ?? null, lastError: lastError ?? null };
    },
    set: async (state) => {
      await redis().set(key, state);
    },
    setError: async (message, at) => {
      await redis().set(errorKey, { message, at });
    },
    clearError: async () => {
      await redis().del(errorKey);
    },
    lock: async (ttlSeconds) => {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ok = (await redis().set(lockKey, token, { nx: true, ex: ttlSeconds })) === "OK";
      if (!ok) return null;
      return async () => {
        // Release only our own lock: a run that outlived its TTL must not drop the next run's.
        await redis().eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', [lockKey], [token]);
      };
    },
  };
}

export function statsContext(chainId: number, budgetMs: number) {
  const { registry, settler, nettingLedger, registryDeployBlock } = addressesForChain(chainId);
  return {
    chainId,
    contracts: { registry, settler, ledger: nettingLedger },
    // The Registry is the earliest of the three deployments on testnet (the Settler and the
    // netting ledger were deployed after it), so its block is a safe floor for all three.
    startBlock: registryDeployBlock,
    now: () => new Date(),
    budgetMs,
  };
}

export type RunResult = ({ ran: true } & Omit<RefreshResult, "state"> & { cursorBlock: string; headBlock: string }) | { ran: false; reason: string };

/// One refresh run under the lock. Logs and records any error, then rethrows it.
export async function runStatsRefresh(opts: {
  store: StatsStore;
  rpc: StatsRpc;
  ctx: ReturnType<typeof statsContext>;
}): Promise<RunResult> {
  const { store, rpc, ctx } = opts;
  // The TTL outlasts the budget plus one in-flight batch, so two runs never overlap.
  const release = await store.lock(Math.ceil(ctx.budgetMs / 1000) + 60);
  if (!release) return { ran: false, reason: "another refresh is running" };
  try {
    const { state: previous } = await store.get();
    const result = await refreshStats(previous, ctx, rpc, (s) => store.set(s));
    await store.clearError();
    return { ran: true, chunks: result.chunks, caughtUp: result.caughtUp, cursorBlock: result.state.cursorBlock, headBlock: result.state.headBlock };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Protocol stats refresh failed:", message);
    await store.setError(message, new Date().toISOString()).catch((e) => console.error("Recording the stats error failed:", e));
    throw error;
  } finally {
    await release().catch((e) => console.error("Releasing the stats lock failed (it expires on its own):", e));
  }
}

export function productionRefresh(budgetMs: number): Promise<RunResult> {
  return runStatsRefresh({
    store: redisStatsStore(STATS_CHAIN_ID),
    rpc: createStatsRpc(logsRpcUrlsFor(STATS_CHAIN_ID)),
    ctx: statsContext(STATS_CHAIN_ID, budgetMs),
  });
}

/// The read path: one Upstash GET. Throws only when Upstash itself can't be read.
export async function getProtocolStats(): Promise<StoredStats> {
  return redisStatsStore(STATS_CHAIN_ID).get();
}

export function needsRefresh(stored: StoredStats, now: Date): boolean {
  if (!stored.state) return true;
  if (BigInt(stored.state.cursorBlock) < BigInt(stored.state.headBlock)) return true;
  return now.getTime() - Date.parse(stored.state.updatedAt) >= REFRESH_AFTER_MS;
}
