/// Runs the webhook pipeline once, if no other run holds the lock. Safe to call often: with
/// nothing to do it's two small queries.

import { postgresWebhookStore } from "../db/webhooks";
import { redis } from "../upstash/client";
import { safePoster } from "./safePoster";
import { deliverDue, fanOutChanges } from "./webhookPipeline";

const LOCK_KEY = "api:webhooks:lock";
const LOCK_SECONDS = 60;

export async function runWebhookPipeline(): Promise<{
  ran: boolean;
  events?: number;
  delivered?: number;
  failed?: number;
  suppressed?: number;
}> {
  const locked = (await redis().set(LOCK_KEY, "1", { nx: true, ex: LOCK_SECONDS })) === "OK";
  if (!locked) return { ran: false };
  try {
    const now = new Date();
    const events = await fanOutChanges(postgresWebhookStore, now);
    const { delivered, failed, suppressed } = await deliverDue(postgresWebhookStore, now, safePoster);
    return { ran: true, events, delivered, failed, suppressed };
  } finally {
    await redis().del(LOCK_KEY).catch(() => {
      // The lock expires on its own.
    });
  }
}

/// For `after()`: webhook trouble is logged, never surfaced to the request that triggered it.
export async function runWebhookPipelineQuietly(): Promise<void> {
  try {
    await runWebhookPipeline();
  } catch (error) {
    console.error("Webhook pipeline failed", error);
  }
}
