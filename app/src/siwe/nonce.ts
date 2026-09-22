/// SIWE nonce issuance and single-use tracking — plans/20-session-wallet-connect.md design
/// decision 4. Uses the already-provisioned Upstash Redis (plans/19-database-blockscout-reconciliation.md
/// provisioned it for exactly this: plan 14 design decision 6 named "payload dedupe" as its job).
/// A stateless (signed, no-storage) nonce was considered and rejected — it can prove freshness but
/// not single-use, which is the actual property SIWE's replay protection needs.

import { randomBytes } from "node:crypto";
import { redis } from "../upstash/client";

const NONCE_TTL_SECONDS = 5 * 60;

function nonceKey(nonce: string): string {
  return `siwe:nonce:${nonce}`;
}

/// Issues a fresh, random nonce and records it as valid-and-unused for NONCE_TTL_SECONDS.
export async function issueNonce(): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  await redis().set(nonceKey(nonce), "1", { ex: NONCE_TTL_SECONDS });
  return nonce;
}

/// Atomically checks a nonce was issued, not expired, and not already used — and consumes it in
/// the same operation (GETDEL), so a replayed sign-in with the same nonce always fails, even under
/// a race between two concurrent verification attempts.
export async function consumeNonce(nonce: string): Promise<boolean> {
  const value = await redis().getdel(nonceKey(nonce));
  return value !== null;
}
