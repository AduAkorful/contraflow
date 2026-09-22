/// Verifies a SIWE sign-in attempt end to end — signature, nonce, domain, expiry. Every check
/// fails closed: any one being wrong rejects the whole sign-in, no partial trust.

import { recoverMessageAddress, isAddress } from "viem";
import { consumeNonce } from "./nonce";

export interface SignInAttempt {
  message: string;
  signature: `0x${string}`;
  expectedDomain: string;
}

export type SignInResult = { ok: true; address: `0x${string}` } | { ok: false; reason: string };

interface ParsedSiweMessage {
  domain: string;
  address: string;
  nonce: string;
  expirationTime: string;
}

/// Parses only the fields this project's own `buildSiweMessage` produces — not a general EIP-4361
/// parser (that's `@spruceid/siwe-parser`'s job if this ever needs to accept messages this app
/// didn't itself construct the shape of; it doesn't, so a general parser would be unused surface).
function parseSiweMessage(message: string): ParsedSiweMessage | null {
  const lines = message.split("\n");
  const domainMatch = lines[0]?.match(/^(.+) wants you to sign in with your Ethereum account:$/);
  const address = lines[1];
  const nonceLine = lines.find((l) => l.startsWith("Nonce: "));
  const expirationLine = lines.find((l) => l.startsWith("Expiration Time: "));
  if (!domainMatch || !address || !nonceLine || !expirationLine) return null;
  return {
    domain: domainMatch[1]!,
    address,
    nonce: nonceLine.slice("Nonce: ".length),
    expirationTime: expirationLine.slice("Expiration Time: ".length),
  };
}

export async function verifySignIn(attempt: SignInAttempt): Promise<SignInResult> {
  const parsed = parseSiweMessage(attempt.message);
  if (!parsed) return { ok: false, reason: "Malformed sign-in message." };

  if (parsed.domain !== attempt.expectedDomain) {
    return { ok: false, reason: `Domain mismatch: expected ${attempt.expectedDomain}, got ${parsed.domain}.` };
  }

  const expiresAt = Date.parse(parsed.expirationTime);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { ok: false, reason: "Sign-in message has expired — request a fresh one." };
  }

  if (!isAddress(parsed.address)) {
    return { ok: false, reason: "Malformed address in sign-in message." };
  }

  // Consumed before signature verification, deliberately — GETDEL is atomic, so this is what
  // actually prevents a replay race: two concurrent requests bearing the same valid signed message
  // can't both pass, since only one can win the nonce. Checking the signature first and consuming
  // the nonce only after would leave that race open until the nonce step ran.
  const nonceOk = await consumeNonce(parsed.nonce);
  if (!nonceOk) {
    return { ok: false, reason: "Nonce is invalid, expired, or already used." };
  }

  let recovered: `0x${string}`;
  try {
    recovered = await recoverMessageAddress({ message: attempt.message, signature: attempt.signature });
  } catch {
    return { ok: false, reason: "Signature does not recover to a valid address." };
  }

  if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
    return { ok: false, reason: "Signature does not match the claimed address." };
  }

  return { ok: true, address: recovered };
}
