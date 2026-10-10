import { runWebhookPipeline } from "@/src/api/webhookRunner";
import { purgeOldUsage } from "@/src/db/usage";

/// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. It's the retry backstop:
/// deliveries also run right after API requests and web-app obligation actions.
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runWebhookPipeline();
  // Housekeeping must never fail the delivery run.
  try {
    await purgeOldUsage();
  } catch (error) {
    console.error("Usage purge failed", error instanceof Error ? error.message : error);
  }
  return Response.json(result);
}
