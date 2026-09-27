import { runWebhookPipeline } from "../../../../src/api/webhookRunner";

/// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. It's the retry backstop:
/// deliveries also run right after API requests and web-app obligation actions.
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await runWebhookPipeline());
}
