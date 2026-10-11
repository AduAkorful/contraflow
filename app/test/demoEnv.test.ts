import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const KEY_A = "0x" + "11".repeat(32);
const KEY_B = "0x" + "22".repeat(32);

async function demoOn(network: string, env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", network);
  vi.stubEnv("DEMO_OPERATOR_PK", env.DEMO_OPERATOR_PK ?? "");
  vi.stubEnv("CONTRAFLOW_OPERATOR_PK", env.CONTRAFLOW_OPERATOR_PK ?? "");
  return import("../src/chain/demoEnv");
}

describe("demo key", () => {
  it("never falls back to the operator key on a deployment that is not testnet", async () => {
    const demo = await demoOn("mainnet", { CONTRAFLOW_OPERATOR_PK: KEY_A });
    expect(demo.demoOperatorAddress()).toBeNull();
    expect(() => demo.demoSigner()).toThrow(/DEMO_OPERATOR_PK/);
  });

  it("uses its own key when set, even where the operator key exists", async () => {
    const withBoth = await demoOn("mainnet", { CONTRAFLOW_OPERATOR_PK: KEY_A, DEMO_OPERATOR_PK: KEY_B });
    const own = await demoOn("mainnet", { DEMO_OPERATOR_PK: KEY_B });
    expect(withBoth.demoOperatorAddress()).toBe(own.demoOperatorAddress());
    expect(withBoth.demoOperatorAddress()).not.toBeNull();
  });

  it("lets a testnet deployment keep using the operator key it already has", async () => {
    const demo = await demoOn("testnet", { CONTRAFLOW_OPERATOR_PK: KEY_A });
    expect(demo.demoOperatorAddress()).not.toBeNull();
  });

  it("always signs on testnet", async () => {
    const demo = await demoOn("mainnet", { DEMO_OPERATOR_PK: KEY_B });
    expect(demo.DEMO_CHAIN_ID).toBe(5042002);
    const signer = demo.demoSigner();
    expect(signer.kind).toBe("raw-key");
  });
});
