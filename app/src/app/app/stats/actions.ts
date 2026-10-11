"use server";

import { after } from "next/server";
import { addressesForChain } from "@/src/contracts/addresses";
import { checkRateLimit } from "@/src/ratelimit/limiter";
import { requestIp } from "@/src/ratelimit/requestIp";
import { getProtocolStats, needsRefresh, PAGE_VIEW_BUDGET_MS, productionRefresh, STALE_AFTER_MS, STATS_CHAIN_ID } from "@/src/stats/load";
import { buildStatsView, type StatsView } from "@/src/stats/view";
import { advanceChainIndexQuietly } from "@/src/chainindex/source";

export type ProtocolStatsResult = { ok: true; view: StatsView } | { ok: false; error: string };

const UNAVAILABLE = "Stats are unavailable right now.";
/// Every request is a single cache read, so this only needs to stop a loop from hammering it.
const MAX_REQUESTS = 30;
const WINDOW_SECONDS = 60;

/// The built view is kept in the server instance for a few seconds, so many open pages asking
/// every 30 seconds cost one cache read per instance per window rather than one per page.
const MEMO_MS = 10_000;
let memo: { at: number; result: ProtocolStatsResult } | null = null;

export async function loadProtocolStats(): Promise<ProtocolStatsResult> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.result;
  const result = await loadFresh();
  if (result.ok) memo = { at: Date.now(), result };
  return result;
}

async function loadFresh(): Promise<ProtocolStatsResult> {
  try {
    const { allowed } = await checkRateLimit(`stats:${await requestIp()}`, MAX_REQUESTS, WINDOW_SECONDS);
    if (!allowed) return { ok: false, error: UNAVAILABLE };
  } catch (error) {
    console.error("Stats rate limiter unavailable:", error);
    return { ok: false, error: UNAVAILABLE };
  }

  try {
    const stored = await getProtocolStats();
    const now = new Date();
    // Keeps the two-party flow's chain index warm while anyone has the page open; it leaves a
    // recently checked index alone and never throws.
    after(() => advanceChainIndexQuietly(STATS_CHAIN_ID));
    // Runs after the response is sent, is capped by a short budget and takes the same lock, so it
    // never slows the page.
    if (needsRefresh(stored, now)) {
      after(async () => {
        try {
          await productionRefresh(PAGE_VIEW_BUDGET_MS);
        } catch {
          // Already logged and recorded by runStatsRefresh.
        }
      });
    }
    if (!stored.state) {
      return { ok: false, error: "Stats are being counted for the first time. Check back in a few minutes." };
    }
    const { registry, settler, nettingLedger } = addressesForChain(STATS_CHAIN_ID);
    return {
      ok: true,
      view: buildStatsView(stored.state, { registry, settler, ledger: nettingLedger }, {
        now,
        staleAfterMs: STALE_AFTER_MS,
        lastError: stored.lastError,
      }),
    };
  } catch (error) {
    console.error("Protocol stats read failed", error);
    return { ok: false, error: UNAVAILABLE };
  }
}
