import { describe, expect, it, vi, beforeEach } from "vitest";

const set = vi.fn();
const getdel = vi.fn();
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({ set, getdel })),
}));

process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

const { issueNonce, consumeNonce } = await import("../src/siwe/nonce");

describe("issueNonce / consumeNonce", () => {
  beforeEach(() => {
    set.mockReset();
    getdel.mockReset();
  });

  it("issues a random hex nonce and stores it with a TTL", async () => {
    set.mockResolvedValueOnce("OK");
    const nonce = await issueNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(set).toHaveBeenCalledWith(`siwe:nonce:${nonce}`, "1", { ex: 5 * 60 });
  });

  it("issues distinct nonces across calls", async () => {
    set.mockResolvedValue("OK");
    const a = await issueNonce();
    const b = await issueNonce();
    expect(a).not.toBe(b);
  });

  it("consumeNonce returns true when the nonce existed (and deletes it)", async () => {
    getdel.mockResolvedValueOnce("1");
    const ok = await consumeNonce("abc123");
    expect(ok).toBe(true);
    expect(getdel).toHaveBeenCalledWith("siwe:nonce:abc123");
  });

  it("consumeNonce returns false for an unknown, expired, or already-used nonce", async () => {
    getdel.mockResolvedValueOnce(null);
    const ok = await consumeNonce("never-issued");
    expect(ok).toBe(false);
  });
});
