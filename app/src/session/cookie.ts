/// Signed session token — plans/20-session-wallet-connect.md design decision 3: a plain
/// HMAC-SHA256-signed cookie payload, not a database row or a JWT library. Nothing about a session
/// needs to be queried, listed, or revoked-by-admin yet, so either would be pure overhead.

import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_SECONDS = 24 * 60 * 60;

export interface SessionPayload {
  address: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("Missing required env var SESSION_SECRET — see app/.env.example");
  return value;
}

function sign(payloadJson: string): string {
  return createHmac("sha256", secret()).update(payloadJson).digest("hex");
}

export function createSessionToken(address: `0x${string}`): string {
  const now = Date.now();
  const payload: SessionPayload = { address, issuedAt: now, expiresAt: now + SESSION_TTL_SECONDS * 1000 };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson).toString("base64url");
  const signature = sign(payloadJson);
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts as [string, string];

  let payloadJson: string;
  try {
    payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedSignature = sign(payloadJson);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expectedSignature, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(payloadJson) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload.address !== "string" || typeof payload.expiresAt !== "number") return null;
  if (Date.now() > payload.expiresAt) return null;

  return payload;
}
