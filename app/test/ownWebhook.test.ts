import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import {
  newWebhookSecret,
  removeOwnWebhook,
  rollOwnWebhookSecret,
  setOwnWebhook,
  testOwnWebhook,
  type OwnWebhookStore,
} from "../src/api/ownWebhook";

const OWNER = getAddress(`0x${"22".repeat(20)}`);
const PUBLIC = async () => [{ address: "93.184.216.34" }];

function store(overrides: Partial<OwnWebhookStore> = {}): OwnWebhookStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    get: async () => null,
    save: async (owner, url, secret) => {
      saved.push({ owner, url, secret });
      return "saved";
    },
    roll: async () => "rolled",
    remove: async () => "removed",
    tenant: async () => ({ tenantId: `0x${"ab".repeat(32)}`, status: "active" }),
    recent: async () => [],
    ...overrides,
  };
}

describe("own webhook endpoint", () => {
  it("makes whsec secrets from 32 random bytes", () => {
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(newWebhookSecret()).not.toBe(secret);
  });

  it("saves a public https endpoint under the lowercased owner and returns the secret once", async () => {
    const backing = store();
    const result = await setOwnWebhook(OWNER, "https://hooks.example.com/cf", backing, { resolve: PUBLIC, secret: () => "whsec_fixed" });
    expect(result).toEqual({ ok: true, secret: "whsec_fixed" });
    expect(backing.saved).toEqual([{ owner: OWNER.toLowerCase(), url: "https://hooks.example.com/cf", secret: "whsec_fixed" }]);
  });

  it("stores nothing when the URL or its DNS answer is unsafe", async () => {
    const backing = store();
    expect((await setOwnWebhook(OWNER, "http://example.com", backing, { resolve: PUBLIC })).ok).toBe(false);
    expect((await setOwnWebhook(OWNER, "https://127.0.0.1/x", backing, { resolve: PUBLIC })).ok).toBe(false);
    const internal = await setOwnWebhook(OWNER, "https://evil.example.com/x", backing, { resolve: async () => [{ address: "169.254.169.254" }] });
    expect(internal.ok).toBe(false);
    expect(backing.saved).toHaveLength(0);
  });

  it("explains a missing tenant and a suspended one", async () => {
    const none = await setOwnWebhook(OWNER, "https://hooks.example.com/cf", store({ save: async () => "no_tenant" }), { resolve: PUBLIC });
    expect(none).toEqual({ ok: false, error: expect.stringContaining("API key first") });
    const suspended = await setOwnWebhook(OWNER, "https://hooks.example.com/cf", store({ save: async () => "suspended" }), { resolve: PUBLIC });
    expect(suspended).toEqual({ ok: false, error: "This API access is suspended." });
  });

  it("rolls a secret, and says so when there is no endpoint", async () => {
    expect(await rollOwnWebhookSecret(OWNER, store(), () => "whsec_new")).toEqual({ ok: true, secret: "whsec_new" });
    const missing = await rollOwnWebhookSecret(OWNER, store({ roll: async () => "no_endpoint" }));
    expect(missing).toEqual({ ok: false, error: "Add an endpoint first." });
  });

  it("removes an endpoint, and says so when there is none", async () => {
    expect(await removeOwnWebhook(OWNER, store())).toEqual({ ok: true });
    expect((await removeOwnWebhook(OWNER, store({ remove: async () => "no_endpoint" }))).ok).toBe(false);
  });

  it("queues a test event for the owner's own tenant only", async () => {
    const enqueue = vi.fn(async () => ({ eventId: "evt_test_1" }));
    const result = await testOwnWebhook(OWNER, { store: store(), enqueue, chainId: 5042002 });
    expect(result).toEqual({ ok: true });
    expect(enqueue).toHaveBeenCalledWith(`0x${"ab".repeat(32)}`, 5042002);
  });

  it("does not queue a test for a suspended tenant, a missing tenant or a missing endpoint", async () => {
    const enqueue = vi.fn(async () => ({ error: "no_endpoint" as const }));
    expect((await testOwnWebhook(OWNER, { store: store({ tenant: async () => null }), enqueue, chainId: 1 })).ok).toBe(false);
    expect((await testOwnWebhook(OWNER, { store: store({ tenant: async () => ({ tenantId: "0x01", status: "suspended" }) }), enqueue, chainId: 1 })).ok).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(await testOwnWebhook(OWNER, { store: store(), enqueue, chainId: 1 })).toEqual({ ok: false, error: "Add an endpoint first." });
  });
});
