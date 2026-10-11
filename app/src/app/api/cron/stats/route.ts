import { productionRefresh, STATS_CHAIN_ID } from "@/src/stats/load";
import { advanceChainIndexQuietly } from "@/src/chainindex/source";

/// Brings protocol stats and the two-party flow's chain index up to date on request, with
/// `Authorization: Bearer $CRON_SECRET`. Nothing schedules it: an open page re-reads the saved
/// figures every 30 seconds and the read starts a small catch-up when they are stale. Each call is
/// incremental and stops after a short budget with its progress saved, so repeated calls catch up;
/// `caughtUp: false` (stats) or `index.caughtUp: false` means call again. A long-lived deployment's
/// first index build is about 330 ranges, so warm it by calling this in a loop.
export const maxDuration = 10;

const STATS_BUDGET_MS = 3_500;
const INDEX_BUDGET_MS = 4_500;

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const stats = await productionRefresh(STATS_BUDGET_MS);
    const index = await advanceChainIndexQuietly(STATS_CHAIN_ID, undefined, INDEX_BUDGET_MS);
    return Response.json({ ...stats, index }, { status: stats.ran ? 200 : 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
