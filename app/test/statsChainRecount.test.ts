/// Live check, off by default: builds the stats from scratch with the app's own RPC indexer and
/// compares every total with an independent recount from the explorer at the same block.
///   STATS_LIVE=1 pnpm vitest run test/statsChainRecount.test.ts
import { describe, expect, it } from "vitest";
import { refreshStats } from "../src/stats/indexer";
import { statsContext } from "../src/stats/load";
import { createStatsRpc } from "../src/stats/rpc";
import { diffTotals, recountFromExplorer } from "../scripts/verify-stats.mjs";

const live = process.env.STATS_LIVE === "1";

describe.skipIf(!live)("protocol stats equal a full independent recount (live chain)", () => {
  it("matches the explorer recount at the indexed block", async () => {
    const ctx = statsContext(5042002, 30 * 60_000);
    const rpc = createStatsRpc(process.env.ARC_TESTNET_RPC || "https://rpc.testnet.arc.io");
    const started = Date.now();
    const { state, caughtUp, chunks } = await refreshStats(null, ctx, rpc, async () => undefined);
    console.log(`indexed ${chunks} chunks to block ${state.cursorBlock} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log("indexer totals", state.totals, "parties", state.parties.length);
    expect(caughtUp).toBe(true);
    const recount = await recountFromExplorer(BigInt(state.cursorBlock));
    console.log("explorer recount", recount.totals, "parties", recount.parties);
    expect(recount.problems).toEqual([]);
    expect(diffTotals(state, recount)).toEqual([]);
  }, 30 * 60_000);
});
