/// Sign-out revocation. A session is still a signed cookie; what's stored is a deny-list of the
/// tokens that have been signed out, each kept only until it would have expired anyway. That is
/// the whole state: no sessions table, and nothing to clean up. A copied cookie stops working the
/// moment its owner signs out.

import { createHash } from "node:crypto";
import { redis } from "../upstash/client";

function revocationKey(token: string): string {
  return `session:revoked:${createHash("sha256").update(token).digest("hex")}`;
}

/// Denies `token` until `expiresAt` (epoch milliseconds). A token that has already expired needs
/// no entry: it can't verify anyway.
export async function revokeSession(token: string, expiresAt: number, now: number = Date.now()): Promise<void> {
  const seconds = Math.ceil((expiresAt - now) / 1000);
  if (seconds <= 0) return;
  await redis().set(revocationKey(token), "1", { ex: seconds });
}

/// Throws if the deny-list can't be read, so a caller decides what an unreadable list means.
export async function isSessionRevoked(token: string): Promise<boolean> {
  return (await redis().exists(revocationKey(token))) > 0;
}
