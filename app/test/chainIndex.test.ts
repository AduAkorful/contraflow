import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Abi, type Hex } from "viem";
import { contraflowSettlerAbi } from "../src/contracts/abi";
import { decodeReceiptLogs, parseRegistryLog, toDecodedLog } from "../src/chainindex/events";
import { MAX_INDEXED_EVENTS, syncChainIndex, type IndexContext } from "../src/chainindex/indexer";
import { memoryChainIndexStore } from "../src/chainindex/store";
import { advanceChainIndexQuietly, ChainIndexBehindError, ensureIndexed, indexedNextNonce, indexedRegistryLogs, type IndexDeps } from "../src/chainindex/source";
import { A, B, C, REGISTRY, fakeIndexRpc, id, nettedLog, registeredLog } from "./helpers/chainIndexFixture";

vi.mock("../src/db/invoices", () => ({}));
const { parseNetted, parseRegistered } = await import("../src/blockscout/reconcile");

const T0 = new Date("2026-10-11T12:00:00.000Z");

function ctx(over: Partial<IndexContext> = {}): IndexContext {
  return { chainId: 5042, contract: REGISTRY, startBlock: 100n, now: () => new Date(T0), budgetMs: 10_000, chunkBlocks: 10n, confirmations: 1n, ...over };
}

const LOGS = [
  registeredLog({ block: 100, index: 0 }, { id: id(1), debtor: A, creditor: B, nonce: 1n }),
  registeredLog({ block: 105, index: 0 }, { id: id(2), debtor: B, creditor: C, nonce: 1n }),
  registeredLog({ block: 112, index: 3 }, { id: id(3), debtor: A, creditor: B, nonce: 2n }),
  nettedLog({ block: 130, index: 1, tx: `0x${"aa".repeat(32)}` }, { id: id(1), wNet: 400_000n, remainingAfter: 600_000n }),
  registeredLog({ block: 149, index: 0 }, { id: id(4), debtor: C, creditor: A, nonce: 1n }),
];

describe("syncChainIndex", () => {
  it("reads in fixed chunks, saving events, nonces and the cursor as it goes", async () => {
    const store = memoryChainIndexStore();
    const rpc = fakeIndexRpc(LOGS, 151n);
    const result = await syncChainIndex(store, rpc, ctx());

    expect(result.caughtUp).toBe(true);
    expect(result.meta.cursorBlock).toBe("150");
    expect(rpc.calls.getLogs[0]).toEqual([100n, 109n]);
    expect(rpc.calls.getLogs.at(-1)).toEqual([150n, 150n]);
    expect(store.events.size).toBe(5);
    expect(store.nonces.get(`${A}:${B}`.toLowerCase())).toBe(2n);
    expect(store.nonces.get(`${C}:${A}`.toLowerCase())).toBe(1n);
    expect(result.meta.events).toBe(5);
    expect(result.meta.truncated).toBe(false);
  });

  it("is safe to run again over the same blocks", async () => {
    const store = memoryChainIndexStore();
    await syncChainIndex(store, fakeIndexRpc(LOGS, 151n), ctx());
    // A crash before the cursor moved: the chunk is read again.
    store.meta && (await store.putMeta({ ...store.meta, cursorBlock: "99", events: 0 }));
    const again = await syncChainIndex(store, fakeIndexRpc(LOGS, 151n), ctx());
    expect(again.meta.events).toBe(5);
    expect(store.events.size).toBe(5);
    expect(store.nonces.get(`${A}:${B}`.toLowerCase())).toBe(2n);
  });

  it("keeps nonces exact when the event cap is reached, and says it was truncated", async () => {
    const store = memoryChainIndexStore();
    const result = await syncChainIndex(store, fakeIndexRpc(LOGS, 151n), ctx({ maxEvents: 2 }));
    expect(result.meta.truncated).toBe(true);
    expect(store.events.size).toBe(2);
    expect(store.nonces.get(`${A}:${B}`.toLowerCase())).toBe(2n);
    expect(MAX_INDEXED_EVENTS).toBeGreaterThan(1_000);
  });

  it("stops at its time budget with progress saved, then carries on", async () => {
    const store = memoryChainIndexStore();
    const first = await syncChainIndex(store, fakeIndexRpc(LOGS, 151n), ctx({ budgetMs: 0 }));
    expect(first.caughtUp).toBe(false);
    expect(first.chunks).toBe(0);
    const second = await syncChainIndex(store, fakeIndexRpc(LOGS, 151n), ctx());
    expect(second.caughtUp).toBe(true);
  });

  it("throws on a Registry log it can't decode and leaves the cursor where it was", async () => {
    const store = memoryChainIndexStore();
    const bad = { ...LOGS[0]!, topics: [`0x${"11".repeat(32)}` as Hex] };
    await expect(syncChainIndex(store, fakeIndexRpc([bad], 151n), ctx())).rejects.toThrow(/Unrecognised Registry log/);
    expect(store.meta).toBeNull();
    expect(store.events.size).toBe(0);
  });

  it("skips admin events and logs from other contracts", async () => {
    const store = memoryChainIndexStore();
    const other = { ...LOGS[0]!, address: "0x00000000000000000000000000000000000000aa" };
    const result = await syncChainIndex(store, fakeIndexRpc([other], 151n), ctx());
    expect(result.meta.events).toBe(0);
  });
});

describe("decoding", () => {
  it("round-trips a registered and a netted event into what the existing parsers read", () => {
    const registered = parseRegistryLog(LOGS[0]!)!;
    const netted = parseRegistryLog(LOGS[3]!)!;
    const r = parseRegistered(toDecodedLog(registered, REGISTRY));
    expect(r).toMatchObject({ invoiceRef: id(1), debtor: A, creditor: B, amountBaseUnits: 1_000_000n, nonce: 1n, earlyNetConsent: false });
    const n = parseNetted(toDecodedLog(netted, REGISTRY));
    expect(n).toMatchObject({ invoiceRef: id(1), wNetBaseUnits: 400_000n, remainingAfterBaseUnits: 600_000n, blockNumber: 130, logIndex: 1 });
  });

  it("decodes a settlement transaction's Registry and Settler logs, and skips everything else", () => {
    const abi = contraflowSettlerAbi as Abi;
    const settled = {
      address: "0x25851c3fa9438AA53B0bd6ecc3347010b3ccB015",
      topics: encodeEventTopics({ abi, eventName: "Settled", args: { caller: A } }) as Hex[],
      data: encodeAbiParameters([{ type: "bytes32[]" }, { type: "uint256" }], [[id(1), id(2)], 400_000n]),
      blockNumber: 130n,
      logIndex: 2,
      transactionHash: `0x${"aa".repeat(32)}`,
    };
    const netted = nettedLog({ block: 130, index: 1 }, { id: id(1), wNet: 400_000n, remainingAfter: 0n });
    const foreign = { ...netted, address: "0x00000000000000000000000000000000000000aa" };
    const logs = decodeReceiptLogs(
      [{ ...netted, blockNumber: 130n }, foreign, settled],
      { registry: REGISTRY, settler: settled.address },
    );
    expect(logs).toHaveLength(2);
    const [n, s] = logs;
    expect(n!.methodCall).toMatch(/^InvoiceNetted/);
    expect(n!.parameters.find((p) => p.name === "wNet")?.value).toBe("400000");
    expect(s!.methodCall).toMatch(/^Settled/);
    expect(s!.parameters.find((p) => p.name === "invoiceIds")?.value).toEqual([id(1), id(2)]);
    expect(s!.parameters.find((p) => p.name === "wNet")?.value).toBe("400000");
  });
});

function deps(logs = LOGS, head = 151n, store = memoryChainIndexStore(), now = () => new Date(T0)): IndexDeps & { rpc: ReturnType<typeof fakeIndexRpc> } {
  const rpc = fakeIndexRpc(logs, head);
  return { store, rpc, context: { chainId: 5042, contract: REGISTRY, startBlock: 100n, now }, sleep: async () => {} };
}

describe("readers", () => {
  it("answers the next nonce from the indexed history", async () => {
    const d = deps();
    expect(await indexedNextNonce(5042, A, B, d)).toBe(3n);
    expect(await indexedNextNonce(5042, B, A, d)).toBe(1n); // direction matters
    expect(await indexedNextNonce(5042, A, C, d)).toBe(1n); // unknown pair
    expect(await indexedNextNonce(5042, A.toLowerCase(), B.toLowerCase(), d)).toBe(3n);
  });

  it("reuses a freshly checked index without another RPC call", async () => {
    const d = deps();
    await ensureIndexed(d);
    const calls = d.rpc.calls.blockNumber;
    await ensureIndexed(d);
    expect(d.rpc.calls.blockNumber).toBe(calls);
  });

  it("fails closed when the RPC fails, rather than answering from a stale index", async () => {
    const d = deps();
    d.rpc.blockNumber = async () => {
      throw new Error("429");
    };
    await expect(indexedNextNonce(5042, A, B, d)).rejects.toBeInstanceOf(ChainIndexBehindError);
  });

  it("fails closed when another run holds the lock for the whole budget", async () => {
    let t = T0.getTime();
    const d = deps(LOGS, 151n, memoryChainIndexStore({ locked: true }), () => new Date(t));
    d.sleep = async (ms) => {
      t += ms;
    };
    await expect(ensureIndexed(d, 1_000)).rejects.toBeInstanceOf(ChainIndexBehindError);
  });

  it("returns the registry's logs newest first, flagged when truncated", async () => {
    const d = deps();
    const { logs, truncated } = await indexedRegistryLogs(5042, d);
    expect(truncated).toBe(false);
    expect(logs.map((l) => l.blockNumber)).toEqual([149, 130, 112, 105, 100]);
    expect(logs[0]!.address).toBe(REGISTRY);
  });
});

describe("advanceChainIndexQuietly", () => {
  it("reports progress when it syncs, and does nothing when the index was just checked", async () => {
    const d = deps();
    const first = await advanceChainIndexQuietly(5042, d);
    expect(first).toEqual({ cursorBlock: "150", headBlock: "150", caughtUp: true });
    const calls = d.rpc.calls.blockNumber;
    expect(await advanceChainIndexQuietly(5042, d)).toBeNull();
    expect(d.rpc.calls.blockNumber).toBe(calls);
  });

  it("never throws, even when the RPC fails", async () => {
    const d = deps();
    d.rpc.blockNumber = async () => {
      throw new Error("429");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(advanceChainIndexQuietly(5042, d)).resolves.toBeNull();
    log.mockRestore();
  });
});
