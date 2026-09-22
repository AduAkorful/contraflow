"use server";

/// Server Action bridging the compose/attest UI to Circle UCW — plans/22-circle-ucw-signing-method.md.
/// No OTP-verified email login built here (Circle's own "Social & Email Authentication" category) —
/// a deliberate scope simplification: the App ID blocker already prevents live-testing anything past
/// this point this session, so building unprovable OTP UI on top wouldn't add verified value.
/// `userId` is derived from the typed email (hashed, not stored raw as a Circle identifier) — the
/// PIN Circle's own hosted UI collects is the actual security boundary being relied on here, not
/// this email step.

import { createHash } from "node:crypto";
import { ensureCircleUser, issueUserToken, beginPinAndWalletSetup, firstUcwWallet, type UcwWallet } from "../../../src/ucw/client";

function userIdFromEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export type BeginUcwSignInResult =
  | { ok: true; userToken: string; encryptionKey: string; challengeId: string }
  | { ok: false; error: string };

export async function beginUcwSignIn(email: string): Promise<BeginUcwSignInResult> {
  if (!email.includes("@")) return { ok: false, error: "Enter a valid email address." };

  try {
    const userId = userIdFromEmail(email);
    await ensureCircleUser(userId);
    const session = await issueUserToken(userId);
    const { challengeId } = await beginPinAndWalletSetup(session.userToken);
    return { ok: true, userToken: session.userToken, encryptionKey: session.encryptionKey, challengeId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to start email sign-in." };
  }
}

export type GetUcwWalletResult = { ok: true; wallet: UcwWallet | null } | { ok: false; error: string };

/// Called after the browser reports the PIN+wallet-setup challenge completed successfully — the
/// challenge's own callback carries no wallet details (see `firstUcwWallet`'s doc comment).
export async function getUcwWallet(userToken: string): Promise<GetUcwWalletResult> {
  try {
    return { ok: true, wallet: await firstUcwWallet(userToken) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to look up the wallet." };
  }
}
