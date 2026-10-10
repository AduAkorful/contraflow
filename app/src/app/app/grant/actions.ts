"use server";

/// The one-time starter gas grant. Any page whose next step is a self-submitted transaction
/// (register, settle, apply a certificate) asks for it; the session decides who receives it.

import { getSession } from "@/src/session/getSession";
import { requestStarterGrant, grantAmountUsdc } from "@/src/attest/starterGrant";

export type GrantResult =
  | { ok: true; alreadyGranted: boolean; txHash?: string; amountUsdc?: string }
  | { ok: false; error: string };

export async function requestGrant(): Promise<GrantResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const result = await requestStarterGrant(session.address);
  if (!result.ok) return { ok: false, error: result.reason };
  if (result.alreadyGranted) return { ok: true, alreadyGranted: true };
  return { ok: true, alreadyGranted: false, txHash: result.txHash, amountUsdc: grantAmountUsdc() };
}
