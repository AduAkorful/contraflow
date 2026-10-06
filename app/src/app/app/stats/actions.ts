"use server";

import { addressesForChain } from "../../../src/contracts/addresses";
import { checkRateLimit } from "../../../src/ratelimit/limiter";
import { requestIp } from "../../../src/ratelimit/requestIp";
import { getProtocolStats, STATS_CHAIN_ID } from "../../../src/stats/load";
import { buildStatsView, type StatsView } from "../../../src/stats/view";

export type ProtocolStatsResult = { ok: true; view: StatsView } | { ok: false; error: string };

const UNAVAILABLE = "Stats are unavailable right now.";
/// Most requests are a single cache read, so this only needs to stop a loop from hammering it.
const MAX_REQUESTS = 30;
const WINDOW_SECONDS = 60;

export async function loadProtocolStats(): Promise<ProtocolStatsResult> {
  try {
    const { allowed } = await checkRateLimit(`stats:${await requestIp()}`, MAX_REQUESTS, WINDOW_SECONDS);
    if (!allowed) return { ok: false, error: UNAVAILABLE };
  } catch {
    // An unreachable limiter fails closed, like the inspector's: it guards the explorer's own limit.
    return { ok: false, error: UNAVAILABLE };
  }

  try {
    const state = await getProtocolStats();
    const { registry, settler, nettingLedger } = addressesForChain(STATS_CHAIN_ID);
    return { ok: true, view: buildStatsView(state, { registry, settler, ledger: nettingLedger }) };
  } catch (error) {
    console.error("Protocol stats failed", error);
    return { ok: false, error: UNAVAILABLE };
  }
}
