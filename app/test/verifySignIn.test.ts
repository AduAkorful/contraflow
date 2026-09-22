import { describe, expect, it, vi, beforeEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { buildSiweMessage } from "../src/siwe/message";

const consumeNonce = vi.fn();
vi.mock("../src/siwe/nonce", () => ({ consumeNonce }));

const { verifySignIn } = await import("../src/siwe/verifySignIn");

const account = privateKeyToAccount(generatePrivateKey());
const DOMAIN = "localhost:3000";

function freshMessage(overrides: Partial<Parameters<typeof buildSiweMessage>[0]> = {}) {
  const now = new Date();
  return buildSiweMessage({
    domain: DOMAIN,
    address: account.address,
    statement: "Sign in to Contraflow.",
    uri: `https://${DOMAIN}`,
    chainId: 5042002,
    nonce: "test-nonce",
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 5 * 60_000).toISOString(),
    ...overrides,
  });
}

describe("verifySignIn", () => {
  beforeEach(() => {
    consumeNonce.mockReset();
  });

  it("accepts a genuinely signed, fresh message with a valid nonce", async () => {
    consumeNonce.mockResolvedValueOnce(true);
    const message = freshMessage();
    const signature = await account.signMessage({ message });

    const result = await verifySignIn({ message, signature, expectedDomain: DOMAIN });

    expect(result).toEqual({ ok: true, address: account.address });
    expect(consumeNonce).toHaveBeenCalledWith("test-nonce");
  });

  it("rejects a domain mismatch — the actual phishing-resistance check", async () => {
    consumeNonce.mockResolvedValueOnce(true);
    const message = freshMessage({ domain: "evil.example" });
    const signature = await account.signMessage({ message });

    const result = await verifySignIn({ message, signature, expectedDomain: DOMAIN });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/domain/i);
  });

  it("rejects an expired message", async () => {
    consumeNonce.mockResolvedValueOnce(true);
    const past = new Date(Date.now() - 10 * 60_000);
    const message = freshMessage({ issuedAt: past.toISOString(), expirationTime: past.toISOString() });
    const signature = await account.signMessage({ message });

    const result = await verifySignIn({ message, signature, expectedDomain: DOMAIN });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/i);
  });

  it("rejects a signature that doesn't match the claimed address", async () => {
    consumeNonce.mockResolvedValueOnce(true);
    const message = freshMessage();
    const otherAccount = privateKeyToAccount(generatePrivateKey());
    const wrongSignature = await otherAccount.signMessage({ message });

    const result = await verifySignIn({ message, signature: wrongSignature, expectedDomain: DOMAIN });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signature/i);
  });

  it("rejects a reused (already-consumed) nonce", async () => {
    consumeNonce.mockResolvedValueOnce(false);
    const message = freshMessage();
    const signature = await account.signMessage({ message });

    const result = await verifySignIn({ message, signature, expectedDomain: DOMAIN });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/nonce/i);
  });

  it("rejects a malformed message", async () => {
    const result = await verifySignIn({ message: "not a siwe message", signature: "0xdead", expectedDomain: DOMAIN });
    expect(result.ok).toBe(false);
    expect(consumeNonce).not.toHaveBeenCalled();
  });
});
