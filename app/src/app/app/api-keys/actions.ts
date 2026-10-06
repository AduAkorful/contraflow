"use server";

import { revalidatePath } from "next/cache";
import { getAddress } from "viem";
import { createTestKeyForOwner, revokeKeyForOwner, type OwnKeyResult } from "@/src/api/ownKeys";
import { postgresOwnKeyStore } from "@/src/db/ownKeys";
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
