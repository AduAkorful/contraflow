import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueApiKey } from "../src/api/keys";
import { memoryTenantStore } from "./helpers/memoryTenantStore";

const TENANT = `0x${"ab".repeat(32)}` as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function addressesWith(network: string | undefined) {
  vi.resetModules();
  if (network === undefined) vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "");
  else vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", network);
  return import("../src/contracts/addresses");
}

describe("which chain a deployment serves", () => {
  it("is testnet unless the network is exactly `mainnet`", async () => {
    for (const value of [undefined, "", "testnet", "Mainnet", "MAINNET", "mainnet ", "5042"]) {
      expect((await addressesWith(value)).APP_CHAIN_ID).toBe(5042002);
    }
    expect((await addressesWith("mainnet")).APP_CHAIN_ID).toBe(5042);
  });

  it("fails closed on mainnet until its addresses are recorded", async () => {
    const mod = await addressesWith("mainnet");
    expect(() => mod.addressesForChain(mod.APP_CHAIN_ID)).toThrow(mod.UnknownChainError);
    // The testnet contracts stay recorded, for the demo and a testnet deployment.
    expect(mod.addressesForChain(mod.ARC_TESTNET_CHAIN_ID).registry).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("builds Mode B signing domains for the chain it serves, and refuses without a deployment", async () => {
    await addressesWith("mainnet");
    const domain = await import("../src/netting/domain");
    expect(() => domain.appLedgerDomain()).toThrow();
    const testnet = await addressesWith("testnet");
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", "testnet");
    const d = await import("../src/netting/domain");
    expect(d.appLedgerDomain().chainId).toBe(BigInt(testnet.ARC_TESTNET_CHAIN_ID));
  });
});

describe("API keys against the deployment's chain", () => {
  async function authOn(network: string) {
    await addressesWith(network);
    return import("../src/api/auth");
  }

  it("answers a test key with test_unavailable on a mainnet deployment", async () => {
    const { authenticate } = await authOn("mainnet");
    const test = issueApiKey("test");
    const store = memoryTenantStore({ [test.hash]: { tenantId: TENANT, mode: "test", revoked: false, tenantActive: true } });
    await expect(authenticate(`Bearer ${test.key}`, store)).rejects.toMatchObject({ status: 403, code: "test_unavailable" });
  });

  it("answers a live key with live_unavailable on a testnet deployment", async () => {
    const { authenticate } = await authOn("testnet");
    const live = issueApiKey("live");
    const store = memoryTenantStore({ [live.hash]: { tenantId: TENANT, mode: "live", revoked: false, tenantActive: true } });
    await expect(authenticate(`Bearer ${live.key}`, store)).rejects.toMatchObject({ status: 403, code: "live_unavailable" });
  });
});

/// Files where naming the testnet chain explicitly is correct: the chain tables, the key-mode map,
/// the SDK enum maps, the Gateway flag (off outside testnet), the demo, copy keyed on the chain it is
/// handed, and the pricing label.
const ALLOWED = new Set([
  "src/contracts/addresses.ts",
  "src/chain/client.ts",
  "src/chain/rpc.ts",
  "src/chain/demoEnv.ts",
  "src/chain/networkNotice.ts",
  "src/api/keys.ts",
  "src/api/ownKeys.ts",
  "src/kits/appkit.ts",
  "src/kits/unifiedBalance.ts",
  "src/kits/gatewayChains.ts",
  "src/kits/browserAdapter.ts",
  "src/attest/grantCopy.ts",
  "src/app/pricing/page.tsx",
  "src/agent/apiBrief.ts",
  "src/app/app/demo/page.tsx",
  "src/blockscout/explorer.ts",
  "src/app/app/demo/actions.ts",
  "src/app/app/api-keys/actions.ts",
  "src/app/app/api-keys/page.tsx",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("testnet literals", () => {
  it("appear only where naming testnet is the point", () => {
    const root = join(__dirname, "..");
    const offenders = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "components"))]
      .map((file) => relative(root, file))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => /ARC_TESTNET_CHAIN_ID|\b5042002\b|\barcTestnet\b/.test(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
