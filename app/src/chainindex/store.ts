/// Storage for the chain index. A cache of chain data, rebuildable from the chain: never a source
/// of truth. The Upstash implementation is the production one; the memory one backs the tests.

import { redis } from "../upstash/client";
import { eventField, type StoredEvent } from "./events";

export interface IndexMeta {
  chainId: number;
  contract: string;
  startBlock: string;
  /// The last block whose logs are in the index.
  cursorBlock: string;
  /// The newest confirmed block seen on the last sync.
  headBlock: string;
  updatedAt: string;
  /// Events stored. Capped; `truncated` says the cap was reached and later events were not kept.
  events: number;
  truncated: boolean;
}

export interface ChainIndexStore {
  getMeta(): Promise<IndexMeta | null>;
  putMeta(meta: IndexMeta): Promise<void>;
  /// Idempotent: the same event written twice is one event.
  putEvents(events: StoredEvent[]): Promise<void>;
  countEvents(): Promise<number>;
  /// Every stored event, oldest first.
  allEvents(): Promise<StoredEvent[]>;
  getNonces(pairs: string[]): Promise<Map<string, bigint>>;
  putNonces(entries: Map<string, bigint>): Promise<void>;
  /// Resolves to a release function, or null when another run holds the lock.
  lock(ttlSeconds: number): Promise<(() => Promise<void>) | null>;
}

export function indexKey(chainId: number, contract: string): string {
  return `chainidx:v1:${chainId}:${contract.toLowerCase()}`;
}

/// Upstash accepts large pipelines but each request has a size limit, so writes go in batches.
const BATCH = 200;

export function redisChainIndexStore(chainId: number, contract: string): ChainIndexStore {
  const key = indexKey(chainId, contract);
  const metaKey = `${key}:meta`;
  const eventsKey = `${key}:events`;
  const noncesKey = `${key}:nonces`;
  const lockKey = `${key}:lock`;
  return {
    getMeta: async () => (await redis().get<IndexMeta>(metaKey)) ?? null,
    putMeta: async (meta) => {
      await redis().set(metaKey, meta);
    },
    putEvents: async (events) => {
      for (let i = 0; i < events.length; i += BATCH) {
        const record: Record<string, string> = {};
        for (const event of events.slice(i, i + BATCH)) record[eventField(event)] = JSON.stringify(event);
        await redis().hset(eventsKey, record);
      }
    },
    countEvents: async () => Number(await redis().hlen(eventsKey)),
    allEvents: async () => {
      const all = (await redis().hgetall<Record<string, unknown>>(eventsKey)) ?? {};
      return Object.keys(all)
        .sort()
        .map((field) => {
          const value = all[field];
          return (typeof value === "string" ? JSON.parse(value) : value) as StoredEvent;
        });
    },
    getNonces: async (pairs) => {
      const out = new Map<string, bigint>();
      if (pairs.length === 0) return out;
      const values = await redis().hmget<Record<string, string | number | null>>(noncesKey, ...pairs);
      for (const pair of pairs) {
        const v = values?.[pair];
        if (v !== null && v !== undefined) out.set(pair, BigInt(v));
      }
      return out;
    },
    putNonces: async (entries) => {
      const list = [...entries.entries()];
      for (let i = 0; i < list.length; i += BATCH) {
        const record: Record<string, string> = {};
        for (const [pair, nonce] of list.slice(i, i + BATCH)) record[pair] = nonce.toString();
        await redis().hset(noncesKey, record);
      }
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

export function memoryChainIndexStore(opts: { locked?: boolean } = {}): ChainIndexStore & { events: Map<string, StoredEvent>; nonces: Map<string, bigint>; meta: IndexMeta | null } {
  const events = new Map<string, StoredEvent>();
  const nonces = new Map<string, bigint>();
  const state = { meta: null as IndexMeta | null, locked: opts.locked ?? false };
  return {
    events,
    nonces,
    get meta() {
      return state.meta;
    },
    getMeta: async () => state.meta,
    putMeta: async (meta) => {
      state.meta = meta;
    },
    putEvents: async (list) => {
      for (const event of list) events.set(eventField(event), event);
    },
    countEvents: async () => events.size,
    allEvents: async () => [...events.keys()].sort().map((k) => events.get(k)!),
    getNonces: async (pairs) => new Map(pairs.filter((p) => nonces.has(p)).map((p) => [p, nonces.get(p)!] as const)),
    putNonces: async (entries) => {
      for (const [pair, nonce] of entries) nonces.set(pair, nonce);
    },
    lock: async () => {
      if (state.locked) return null;
      state.locked = true;
      return async () => {
        state.locked = false;
      };
    },
  };
}
