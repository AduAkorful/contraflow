/// Server-only: the `StatsRpc` used in production, over the app's Arc RPC.

import { numberToHex, type Hex } from "viem";
import { chainById } from "../chain/client";
import type { RawLog } from "./events";
import type { StatsRpc } from "./indexer";

/// The public Arc RPC answers HTTP 429 ("rate limit exceeded") after about 70 requests in a minute
/// and then blocks for a while (measured 2026-10-11). One call a second backfilled the whole
/// history without a single 429. A 429 still backs off for 1, 2, 3, then 4 seconds.
const ATTEMPTS = 5;
const MIN_INTERVAL_MS = 1_000;

interface RpcLog {
  address: string;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash: string;
  blockTimestamp?: Hex;
  removed?: boolean;
}

export function rpcUrlFor(chainId: number): string {
  return process.env.ARC_TESTNET_RPC || chainById(chainId).rpcUrls.default.http[0]!;
}

export function createStatsRpc(url: string, fetchImpl: typeof fetch = fetch, minIntervalMs = MIN_INTERVAL_MS): StatsRpc {
  let id = 0;
  let nextAt = 0;
  async function pace(): Promise<void> {
    const wait = nextAt - Date.now();
    nextAt = Math.max(nextAt, Date.now()) + minIntervalMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      await pace();
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        });
        if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
        const body = (await res.json()) as { result?: T; error?: { message?: string } };
        if (body.error) throw new Error(`${method}: ${body.error.message ?? "RPC error"}`);
        return body.result as T;
      } catch (error) {
        lastError = error;
        if (attempt < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  const timestamps = new Map<string, number>();
  async function timestampOf(blockNumber: Hex): Promise<number> {
    const cached = timestamps.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await call<{ timestamp: Hex }>("eth_getBlockByNumber", [blockNumber, false]);
    const ts = Number(BigInt(block.timestamp));
    timestamps.set(blockNumber, ts);
    return ts;
  }

  return {
    blockNumber: async () => BigInt(await call<Hex>("eth_blockNumber", [])),
    getLogs: async (addresses, fromBlock, toBlock) => {
      const logs = await call<RpcLog[]>("eth_getLogs", [
        { address: addresses, fromBlock: numberToHex(fromBlock), toBlock: numberToHex(toBlock) },
      ]);
      const out: RawLog[] = [];
      for (const log of logs) {
        out.push({
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockNumber: BigInt(log.blockNumber),
          logIndex: Number(BigInt(log.logIndex)),
          transactionHash: log.transactionHash,
          // Arc includes the timestamp on each log; other nodes may not.
          blockTimestamp: log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : await timestampOf(log.blockNumber),
          removed: log.removed,
        });
      }
      return out;
    },
  };
}
