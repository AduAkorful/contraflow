import { describe, expect, it } from "vitest";
import { toFunctionSelector, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ApiError, authenticate, requirePartyScope, type StoredKey, type StoredPermission } from "../src/api/auth";
import { memoryTenantStore as memoryStore } from "./helpers/memoryTenantStore";
import { hashApiKey, issueApiKey, keyMode } from "../src/api/keys";
import { MAX_PERMISSION_SECONDS, SCOPE, permissionTypedData, validatePermission, type TenantPermission } from "../src/api/permissions";
import type { ChainReader } from "../src/netting/signature";

const TESTNET = 5042002;
const TENANT: Hex = `0x${"ab".repeat(32)}`;
const NOW = 1_800_000_000n;
const NONCE: Hex = `0x${"01".repeat(32)}`;

/// An EOA-only chain: no code anywhere.
const eoaChain: ChainReader = {
  getCode: async () => undefined,
  readContract: async () => "0x00000000",
  getChainId: async () => TESTNET,
} as unknown as ChainReader;

describe("API keys", () => {
  it("issues test and live keys that parse back to their mode and hash stably", () => {
    const test = issueApiKey("test");
    const live = issueApiKey("live");
    expect(keyMode(test.key)).toBe("test");
    expect(keyMode(live.key)).toBe("live");
    expect(test.key.startsWith("cfk_test_")).toBe(true);
    expect(hashApiKey(test.key)).toBe(test.hash);
    expect(test.hash).not.toContain(test.key.slice(9));
    expect(test.displayPrefix).toHaveLength(13);
  });

  it("rejects anything not shaped like a key", () => {
    for (const bad of ["", "cfk_test_short", "sk_test_" + "a".repeat(43), "cfk_prod_" + "a".repeat(43)]) expect(keyMode(bad)).toBeNull();
  });
});

describe("authenticate", () => {
  const { key, hash } = issueApiKey("test");

  it("resolves a valid test key to its tenant on testnet", async () => {
    const store = memoryStore({ [hash]: { tenantId: TENANT, mode: "test", revoked: false, tenantActive: true } });
    await expect(authenticate(`Bearer ${key}`, store)).resolves.toEqual({ tenantId: TENANT, mode: "test", chainId: TESTNET });
  });

  it("rejects missing, malformed, unknown, revoked and suspended keys the same way", async () => {
    const cases: [string | null, Record<string, StoredKey>][] = [
      [null, {}],
      ["Basic abc", {}],
      [`Bearer ${key}`, {}],
      [`Bearer ${key}`, { [hash]: { tenantId: TENANT, mode: "test", revoked: true, tenantActive: true } }],
      [`Bearer ${key}`, { [hash]: { tenantId: TENANT, mode: "test", revoked: false, tenantActive: false } }],
    ];
    for (const [header, keys] of cases) {
      await expect(authenticate(header, memoryStore(keys))).rejects.toMatchObject({ status: 401 });
    }
  });

  it("refuses live keys until mainnet is deployed", async () => {
    const live = issueApiKey("live");
    const store = memoryStore({ [live.hash]: { tenantId: TENANT, mode: "live", revoked: false, tenantActive: true } });
    await expect(authenticate(`Bearer ${live.key}`, store)).rejects.toMatchObject({ status: 403, code: "live_unavailable" });
  });
});

async function signed(permission: TenantPermission, privateKey = generatePrivateKey()) {
  const account = privateKeyToAccount(privateKey);
  const withParty = { ...permission, party: account.address };
  const signature = await account.signTypedData(permissionTypedData(TESTNET, withParty));
  return { permission: withParty, signature, account };
}

const base: TenantPermission = {
  party: "0x0000000000000000000000000000000000000001",
  tenantId: TENANT,
  scopes: SCOPE.read | SCOPE.propose,
  expiresAt: NOW + 3600n,
  nonce: NONCE,
};

function asInput(p: TenantPermission) {
  return { ...p, expiresAt: p.expiresAt.toString() };
}

const ctx = { chainId: TESTNET, tenantId: TENANT, nowSeconds: NOW, client: eoaChain };

describe("validatePermission", () => {
  it("accepts a permission the party signed", async () => {
    const { permission, signature } = await signed(base);
    const result = await validatePermission(asInput(permission), signature, ctx);
    expect(result).toEqual({ ok: true, permission });
  });

  it("rejects a signature from anyone but the party", async () => {
    const { permission } = await signed(base);
    const other = await privateKeyToAccount(generatePrivateKey()).signTypedData(permissionTypedData(TESTNET, permission));
    expect(await validatePermission(asInput(permission), other, ctx)).toMatchObject({ ok: false });
  });

  it("rejects a permission for another tenant, or signed for another chain", async () => {
    const { permission, signature } = await signed(base);
    expect(await validatePermission(asInput(permission), signature, { ...ctx, tenantId: `0x${"cd".repeat(32)}` })).toMatchObject({ ok: false });
    const account = privateKeyToAccount(generatePrivateKey());
    const p = { ...base, party: account.address };
    const wrongChain = await account.signTypedData(permissionTypedData(5042, p));
    expect(await validatePermission(asInput(p), wrongChain, ctx)).toMatchObject({ ok: false });
  });

  it("rejects expired, over-long, empty and unknown scopes", async () => {
    for (const bad of [
      { ...base, expiresAt: NOW },
      { ...base, expiresAt: NOW + MAX_PERMISSION_SECONDS + 1n },
      { ...base, scopes: 0 },
      { ...base, scopes: 8 },
    ]) {
      const { permission, signature } = await signed(bad);
      expect(await validatePermission(asInput(permission), signature, ctx)).toMatchObject({ ok: false });
    }
  });

  it("accepts a smart account's ERC-1271 signature, and nothing it rejects", async () => {
    const wallet: Address = "0x00000000000000000000000000000000000000aa";
    const magic = toFunctionSelector("isValidSignature(bytes32,bytes)");
    const chain = (answer: Hex): ChainReader =>
      ({ getCode: async () => "0x6001", readContract: async () => answer, getChainId: async () => TESTNET }) as unknown as ChainReader;
    const p = { ...base, party: wallet };
    expect(await validatePermission(asInput(p), "0x1234", { ...ctx, client: chain(magic) })).toMatchObject({ ok: true });
    expect(await validatePermission(asInput(p), "0x1234", { ...ctx, client: chain("0xffffffff") })).toMatchObject({ ok: false });
  });
});

describe("requirePartyScope", () => {
  const caller = { tenantId: TENANT, mode: "test" as const, chainId: TESTNET };
  const party: Address = "0x00000000000000000000000000000000000000bb";

  async function storeWith(p: Partial<StoredPermission>) {
    const store = memoryStore();
    await store.savePermission({
      permissionId: "p1",
      tenantId: TENANT,
      chainId: TESTNET,
      party,
      scopes: SCOPE.read,
      expiresAt: NOW + 100n,
      nonce: NONCE,
      signature: "0x",
      ...p,
    });
    return store;
  }

  it("allows a live permission with the scope", async () => {
    await expect(requirePartyScope(caller, party, "read", await storeWith({}), NOW)).resolves.toBeUndefined();
  });

  it("answers Not found for a missing scope, an expired or revoked permission, or another chain", async () => {
    const notFound = { status: 404, code: "not_found" };
    await expect(requirePartyScope(caller, party, "propose", await storeWith({}), NOW)).rejects.toMatchObject(notFound);
    await expect(requirePartyScope(caller, party, "read", await storeWith({ expiresAt: NOW }), NOW)).rejects.toMatchObject(notFound);
    const revoked = await storeWith({});
    await revoked.revokePermission(TENANT, "p1");
    await expect(requirePartyScope(caller, party, "read", revoked, NOW)).rejects.toMatchObject(notFound);
    await expect(requirePartyScope(caller, party, "read", await storeWith({ chainId: 5042 }), NOW)).rejects.toBeInstanceOf(ApiError);
  });
});
