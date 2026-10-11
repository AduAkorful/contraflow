import { beforeEach, describe, expect, it, vi } from "vitest";
import { A, B, C, REGISTRY, fakeIndexRpc, id, registeredLog } from "./helpers/chainIndexFixture";
import { memoryChainIndexStore } from "../src/chainindex/store";

// `resolveNextNonce` reads the chain index; the index's storage and RPC are replaced here, the
// decoding and indexing are the real code.
const holder = vi.hoisted(() => ({ store: null as unknown, rpc: null as unknown }));
vi.mock("../src/chainindex/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/chainindex/store")>()),
  redisChainIndexStore: () => holder.store,
}));
vi.mock("../src/stats/rpc", () => ({ createStatsRpc: () => holder.rpc }));

const { resolveNextNonce } = await import("../src/attest/nextNonce");
const { addressesForChain, APP_CHAIN_ID } = await import("../src/contracts/addresses");

function install(logs: ReturnType<typeof registeredLog>[]) {
  // The fixture's registry address is the recorded testnet Registry, which this suite selects.
  expect(addressesForChain(APP_CHAIN_ID).registry).toBe(REGISTRY);
  holder.store = memoryChainIndexStore();
  holder.rpc = fakeIndexRpc(logs, addressesForChain(APP_CHAIN_ID).registryDeployBlock + 50n);
}

const base = addressesForChain(APP_CHAIN_ID).registryDeployBlock;
const at = (offset: number) => ({ block: Number(base) + offset, index: 0 });
const reg = (offset: number, debtor: `0x${string}`, creditor: `0x${string}`, nonce: bigint, n: number) =>
  registeredLog(at(offset), { id: id(n), debtor, creditor, nonce });

describe("resolveNextNonce", () => {
  beforeEach(() => install([]));

  it("returns 1 for a pair with no prior history", async () => {
    expect(await resolveNextNonce(A, B)).toBe(1n);
  });

  it("returns max(nonce)+1 for a pair with prior registrations", async () => {
    install([reg(1, A, B, 1n, 1), reg(2, A, B, 2n, 2), reg(3, A, B, 3n, 3)]);
    expect(await resolveNextNonce(A, B)).toBe(4n);
  });

  it("ignores registrations for a different pair", async () => {
    install([reg(1, A, B, 1n, 1), reg(2, C, B, 5n, 2), reg(3, A, C, 9n, 3)]);
    expect(await resolveNextNonce(A, B)).toBe(2n);
  });

  it("matches addresses case-insensitively", async () => {
    install([reg(1, A, B, 1n, 1)]);
    expect(await resolveNextNonce(A.toLowerCase() as `0x${string}`, B.toLowerCase() as `0x${string}`)).toBe(2n);
  });

  it("refuses to answer when the chain can't be read", async () => {
    install([]);
    (holder.rpc as { blockNumber: () => Promise<bigint> }).blockNumber = async () => {
      throw new Error("rpc down");
    };
    await expect(resolveNextNonce(A, B)).rejects.toThrow();
  });
});
