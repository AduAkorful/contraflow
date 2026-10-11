import { CRON_BUDGET_MS, productionRefresh } from "@/src/stats/load";

/// Brings protocol stats up to date. Called every 5 minutes by the GitHub Actions workflow
/// `.github/workflows/stats-refresh.yml` with `Authorization: Bearer $CRON_SECRET` (Vercel Hobby
/// crons run at most daily). Each call is incremental and stops after a short budget with its
/// progress saved, so repeated calls catch up; `caughtUp: false` means call again.
export const maxDuration = 10;

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await productionRefresh(CRON_BUDGET_MS);
    return Response.json(result, { status: result.ran ? 200 : 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
