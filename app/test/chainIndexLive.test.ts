/// Live check, off by default: builds the Registry index from the deployment block with the app's
/// own indexer and compares it with the block explorer's decoded logs for the same contract.
///   CHAIN_INDEX_LIVE=1 pnpm vitest run test/chainIndexLive.test.ts
import { describe, expect, it } from "vitest";
import { fetchContractLogsBounded } from "../src/blockscout/client";
import { toDecodedLog } from "../src/chainindex/events";
import { syncChainIndex } from "../src/chainindex/indexer";
import { memoryChainIndexStore } from "../src/chainindex/store";
import { addressesForChain } from "../src/contracts/addresses";
import { createStatsRpc } from "../src/stats/rpc";

const live = process.env.CHAIN_INDEX_LIVE === "1";

describe.skipIf(!live)("chain index equals the explorer's Registry logs (live testnet)", () => {
  it("has the same events and the same largest nonce per pair", async () => {
    const chainId = 5042002;
    const { registry, registryDeployBlock } = addressesForChain(chainId);
    const store = memoryChainIndexStore();
    const rpc = createStatsRpc(["https://rpc.testnet.arc.io", "https://rpc.blockdaemon.testnet.arc.io", "https://rpc.quicknode.testnet.arc.io"]);
    const started = Date.now();
    const { meta, chunks, caughtUp } = await syncChainIndex(store, rpc, {
      chainId,
      contract: registry,
      startBlock: registryDeployBlock,
      now: () => new Date(),
      budgetMs: 25 * 60_000,
    });
    console.log(`indexed ${chunks} chunks to block ${meta.cursorBlock} in ${((Date.now() - started) / 1000).toFixed(1)}s; ${meta.events} events`);
    expect(caughtUp).toBe(true);

    const explorer = await fetchContractLogsBounded(registry);
    expect(explorer.truncated).toBe(false);
    const wanted = (log: { methodCall: string | null }) => /^(InvoiceRegistered|InvoiceNetted)/.test(log.methodCall ?? "");
    const theirs = explorer.logs.filter(wanted).filter((l) => l.blockNumber <= Number(meta.cursorBlock));
    const mine = (await store.allEvents()).map((e) => toDecodedLog(e, registry));

    const key = (l: { transactionHash: string; logIndex?: number }) => `${l.transactionHash.toLowerCase()}#${l.logIndex ?? 0}`;
    const theirKeys = new Set(theirs.map(key));
    const myKeys = new Set(mine.map(key));
    console.log(`explorer ${theirKeys.size} events, index ${myKeys.size} events`);
    expect([...theirKeys].filter((k) => !myKeys.has(k))).toEqual([]);
    expect([...myKeys].filter((k) => !theirKeys.has(k))).toEqual([]);

    const maxByPair = new Map<string, bigint>();
    for (const log of theirs) {
      if (!log.methodCall?.startsWith("InvoiceRegistered")) continue;
      const p = (name: string) => String(log.parameters.find((x) => x.name === name)?.value);
      const pair = `${p("debtor").toLowerCase()}:${p("creditor").toLowerCase()}`;
      const nonce = BigInt(p("nonce"));
      if (nonce > (maxByPair.get(pair) ?? 0n)) maxByPair.set(pair, nonce);
    }
    const stored = await store.getNonces([...maxByPair.keys()]);
    for (const [pair, nonce] of maxByPair) expect(stored.get(pair)).toBe(nonce);
    console.log(`${maxByPair.size} pairs checked`);
  }, 30 * 60_000);
});
