import { describe, expect, it, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { createSessionToken, verifySessionToken } from "../src/session/cookie";

const ADDRESS = "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C" as const;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-do-not-use-in-production";
});

describe("session token", () => {
  it("round-trips a valid token back to its address", () => {
    const token = createSessionToken(ADDRESS);
    const payload = verifySessionToken(token);
    expect(payload?.address).toBe(ADDRESS);
  });

  it("rejects a token whose payload was tampered with", () => {
    const token = createSessionToken(ADDRESS);
    const [payloadB64, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ address: "0xEvil", issuedAt: 0, expiresAt: Date.now() + 999999 }))
      .toString("base64url");
    const tampered = `${forged}.${signature}`;
    expect(verifySessionToken(tampered)).toBeNull();
    // sanity: the original, untampered token still verifies
    expect(verifySessionToken(`${payloadB64}.${signature}`)?.address).toBe(ADDRESS);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken(ADDRESS);
    process.env.SESSION_SECRET = "a-different-secret";
    expect(verifySessionToken(token)).toBeNull();
    process.env.SESSION_SECRET = "test-secret-do-not-use-in-production";
  });

  it("rejects an expired token", () => {
    const payload = { address: ADDRESS, issuedAt: 0, expiresAt: Date.now() - 1000 };
    const payloadJson = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadJson).toString("base64url");
    const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(payloadJson).digest("hex");
    const expiredToken = `${payloadB64}.${signature}`;
    expect(verifySessionToken(expiredToken)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifySessionToken("not-a-real-token")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
  });
});
