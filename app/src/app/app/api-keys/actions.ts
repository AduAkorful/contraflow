"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getAddress } from "viem";
import { createTestKeyForOwner, revokeKeyForOwner, type OwnKeyResult } from "@/src/api/ownKeys";
import { postgresOwnKeyStore } from "@/src/db/ownKeys";
import {
  OWN_WEBHOOK_UNAVAILABLE,
  removeOwnWebhook,
  rollOwnWebhookSecret,
  setOwnWebhook,
  testOwnWebhook,
  type OwnWebhookResult,
} from "@/src/api/ownWebhook";
import { postgresOwnWebhookStore } from "@/src/db/ownWebhook";
import { enqueueWebhookTest } from "@/src/db/webhooks";
import { runWebhookPipelineQuietly } from "@/src/api/webhookRunner";
import { ARC_TESTNET_CHAIN_ID } from "@/src/contracts/addresses";
import { checkRateLimit } from "@/src/ratelimit/limiter";
import { getSession } from "@/src/session/getSession";

async function limitWrites(address: string): Promise<string | null> {
  try {
    const { allowed } = await checkRateLimit(`api-keys:${address}`, 10, 600);
    return allowed ? null : "Too many key changes. Try again in a few minutes.";
  } catch {
    return "API keys aren't available right now.";
  }
}

export async function createOwnTestKey(): Promise<OwnKeyResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };
  const owner = getAddress(session.address);
  const limited = await limitWrites(owner.toLowerCase());
  if (limited) return { ok: false, error: limited };
  try {
    const result = await createTestKeyForOwner(owner, postgresOwnKeyStore);
    if (result.ok) revalidatePath("/app/api-keys");
    return result;
  } catch {
    return { ok: false, error: "API keys aren't available right now." };
  }
}

export async function revokeOwnTestKey(prefix: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };
  const owner = getAddress(session.address);
  const limited = await limitWrites(owner.toLowerCase());
  if (limited) return { ok: false, error: limited };
  try {
    const result = await revokeKeyForOwner(owner, prefix, postgresOwnKeyStore);
    if (result.ok) revalidatePath("/app/api-keys");
    return result;
  } catch {
    return { ok: false, error: "API keys aren't available right now." };
  }
}

async function webhookAction(
  limitKey: string,
  max: number,
  run: (owner: ReturnType<typeof getAddress>) => Promise<OwnWebhookResult>,
): Promise<OwnWebhookResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };
  const owner = getAddress(session.address);
  try {
    const { allowed } = await checkRateLimit(`${limitKey}:${owner.toLowerCase()}`, max, 600);
    if (!allowed) return { ok: false, error: "Too many changes. Try again in a few minutes." };
    const result = await run(owner);
    if (result.ok) revalidatePath("/app/api-keys");
    return result;
  } catch {
    return { ok: false, error: OWN_WEBHOOK_UNAVAILABLE };
  }
}

export async function saveOwnWebhook(url: string): Promise<OwnWebhookResult> {
  return webhookAction("api-webhook", 10, (owner) =>
    setOwnWebhook(owner, url, postgresOwnWebhookStore, { allowLocalHttp: process.env.NODE_ENV !== "production" }),
  );
}

export async function rollOwnWebhook(): Promise<OwnWebhookResult> {
  return webhookAction("api-webhook", 10, (owner) => rollOwnWebhookSecret(owner, postgresOwnWebhookStore));
}

export async function deleteOwnWebhook(): Promise<OwnWebhookResult> {
  return webhookAction("api-webhook", 10, (owner) => removeOwnWebhook(owner, postgresOwnWebhookStore));
}

export async function sendOwnWebhookTest(): Promise<OwnWebhookResult> {
  return webhookAction("api-webhook-test", 5, async (owner) => {
    const result = await testOwnWebhook(owner, {
      store: postgresOwnWebhookStore,
      enqueue: enqueueWebhookTest,
      chainId: ARC_TESTNET_CHAIN_ID,
    });
    if (result.ok) after(runWebhookPipelineQuietly);
    return result;
  });
}
