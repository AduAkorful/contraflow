import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, pad, type Abi, type AbiEvent, type Hex } from "viem";
import { fetchContractLogsSince } from "../src/blockscout/client";
import { contraflowNettingLedgerAbi, contraflowRegistryAbi, contraflowSettlerAbi } from "../src/contracts/abi";
import { emptyState, foldEvents, isCaughtUp, type StatsState } from "../src/stats/aggregate";
import { parseStatsEvent, UnrecognisedStatsEvent, type RawLog } from "../src/stats/events";
import { refreshStats, type IndexerContext, type StatsRpc } from "../src/stats/indexer";
import { needsRefresh, runStatsRefresh, statsContext, type StatsStore, type StoredStats } from "../src/stats/load";
import { createStatsRpc } from "../src/stats/rpc";
import { formatCount, formatUsdc } from "../src/stats/format";
import { buildStatsView, VALUE_NETTED_NOTE } from "../src/stats/view";

const CHAIN_ID = 5042002;
const CONTRACTS = {
  registry: "0x304450Dc27f644AcA55773895409ff500AFb2Bf7",
  settler: "0x25851c3fa9438AA53B0bd6ecc3347010b3ccB015",
  ledger: "0x2F5996aaE68CbC8026543c405Cc81C26D58c2ef7",
};
const PARTY_A = "0xCFd6d6ab5128Da8960882921ff36EC0bBe65adEB";
const PARTY_B = "0xB76FF3Cb47747590558A4240aB5dadE181331911";
const ID = pad("0x01");
const T0 = "2026-09-25T10:00:00.000Z";

let nextIndex = 0;
function encode(abi: unknown, address: string, eventName: string, args: Record<string, unknown>, block: bigint, opts: Partial<RawLog> = {}): RawLog {
  const event = (abi as Abi).find((x) => x.type === "event" && x.name === eventName) as AbiEvent;
  const topics = encodeEventTopics({ abi: [event], eventName, args } as never) as Hex[];
  const data = encodeAbiParameters(
    event.inputs.filter((i) => !i.indexed),
    event.inputs.filter((i) => !i.indexed).map((i) => args[i.name!]),
  );
  const logIndex = nextIndex++;
  return { address, topics, data, blockNumber: block, logIndex, transactionHash: `0xtx${logIndex}`, blockTimestamp: 1_790_000_000 + Number(block), ...opts };
}
const registered = (amount: bigint, block: bigint, debtor = PARTY_A, creditor = PARTY_B) =>
  encode(contraflowRegistryAbi, CONTRACTS.registry, "InvoiceRegistered", { id: ID, debtor, creditor, amount, maturity: 1n, earlyNetConsent: true, nonce: 1n }, block);
const netted = (wNet: bigint, status: number, block: bigint) =>
  encode(contraflowRegistryAbi, CONTRACTS.registry, "InvoiceNetted", { id: ID, wNet, remainingAfter: 0n, status }, block);
const settled = (block: bigint) => encode(contraflowSettlerAbi, CONTRACTS.settler, "Settled", { invoiceIds: [ID], wNet: 1n, caller: PARTY_A }, block);
const applied = (block: bigint) =>
  encode(contraflowNettingLedgerAbi, CONTRACTS.ledger, "CertificateApplied", { certificateId: ID, contentHash: ID, submitter: PARTY_A }, block);
const advanced = (block: bigint) =>
  encode(contraflowNettingLedgerAbi, CONTRACTS.ledger, "ObligationAdvanced", { obligationKey: ID, certificateId: ID, priorCommitment: ID, nextCommitment: ID }, block);

describe("parseStatsEvent", () => {
  it("decodes every counted event from raw logs", () => {
    expect(parseStatsEvent("registry", registered(5n, 10n))).toMatchObject({ kind: "registered", amount: 5n, debtor: PARTY_A });
    expect(parseStatsEvent("registry", netted(3n, 1, 10n))).toMatchObject({ kind: "netted", wNet: 3n, fullyNetted: true });
    expect(parseStatsEvent("registry", netted(3n, 0, 10n))).toMatchObject({ fullyNetted: false });
    expect(parseStatsEvent("settler", settled(10n))).toMatchObject({ kind: "settled" });
    expect(parseStatsEvent("ledger", applied(10n))).toMatchObject({ kind: "certificateApplied" });
    expect(parseStatsEvent("ledger", advanced(10n))).toMatchObject({ kind: "obligationAdvanced" });
  });

  it("ignores proxy admin events", () => {
    const log = encode(contraflowRegistryAbi, CONTRACTS.registry, "Initialized", { version: 1n }, 10n);
    expect(parseStatsEvent("registry", log)).toBeNull();
  });

  it("throws on a log it can't decode rather than dropping it", () => {
    expect(() => parseStatsEvent("registry", { ...settled(10n), address: CONTRACTS.registry })).toThrow(UnrecognisedStatsEvent);
  });
});

describe("foldEvents", () => {
  const base = () => emptyState(CHAIN_ID, 1n, T0);
  const ev = (log: RawLog, c: "registry" | "settler" | "ledger") => parseStatsEvent(c, log)!;

  it("sums every figure, operator activity included", () => {
    const s = foldEvents(base(), [
      ev(registered(1_000_000n, 5n), "registry"),
      ev(registered(2_000_000n, 6n, PARTY_B, PARTY_A.toLowerCase()), "registry"),
      ev(netted(500_000n, 0, 7n), "registry"),
      ev(netted(1_000_000n, 1, 7n), "registry"),
      ev(settled(7n), "settler"),
      ev(applied(8n), "ledger"),
      ev(advanced(8n), "ledger"),
    ]);
    expect(s.totals).toEqual({
      invoicesRegistered: 2,
      faceValueRegistered: "3000000",
      valueNetted: "1500000",
      fullyNetted: 1,
      invoiceLoopsSettled: 1,
      certificatesApplied: 1,
      obligationUpdates: 1,
    });
    expect(s.parties).toEqual([PARTY_B.toLowerCase(), PARTY_A.toLowerCase()].sort());
    expect(s.firstEventAt).toBe(new Date((1_790_000_000 + 5) * 1000).toISOString());
  });

  it("is idempotent: duplicates and already-counted blocks count once", () => {
    const e = ev(registered(1n, 5n), "registry");
    const once = foldEvents(base(), [e, e]);
    expect(once.totals.invoicesRegistered).toBe(1);
    const replay = foldEvents({ ...once, cursorBlock: "5" }, [e]);
    expect(replay.totals.invoicesRegistered).toBe(1);
  });
});

function fakeRpc(logs: RawLog[], head: bigint, failAt?: bigint): StatsRpc & { calls: [bigint, bigint][] } {
  const calls: [bigint, bigint][] = [];
  return {
    calls,
    blockNumber: async () => head,
    getLogs: async (_a, from, to) => {
      calls.push([from, to]);
      if (failAt !== undefined && from <= failAt && failAt <= to) throw new Error("rpc down");
      return logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
    },
  };
}
const ctx = (over: Partial<IndexerContext> = {}): IndexerContext => ({
  chainId: CHAIN_ID,
  contracts: CONTRACTS,
  startBlock: 1n,
  now: () => new Date(T0),
  budgetMs: 60_000,
  chunkBlocks: 10n,
  confirmations: 2n,
  ...over,
});

describe("refreshStats", () => {
  const logs = [registered(1n, 3n), registered(2n, 15n), netted(1n, 1, 25n), applied(41n), settled(48n), advanced(49n)];

  it("reads in chunks up to head minus confirmations, saving after each chunk", async () => {
    const saves: StatsState[] = [];
    const rpc = fakeRpc(logs, 50n);
    const { state, caughtUp } = await refreshStats(null, ctx(), rpc, async (s) => void saves.push(s));
    expect(rpc.calls.map(([f, t]) => `${f}-${t}`)).toEqual(["1-10", "11-20", "21-30", "31-40", "41-48"]);
    expect(caughtUp).toBe(true);
    expect(state.cursorBlock).toBe("48");
    // advanced(49) is not yet confirmed.
    expect(state.totals).toMatchObject({ invoicesRegistered: 2, valueNetted: "1", certificatesApplied: 1, invoiceLoopsSettled: 1, obligationUpdates: 0 });
    expect(saves.map((s) => s.cursorBlock).slice(0, 5)).toEqual(["10", "20", "30", "40", "48"]);
  });

  it("keeps progress on a partial failure and finishes on the next run with the same totals", async () => {
    const saves: StatsState[] = [];
    await expect(refreshStats(null, ctx(), fakeRpc(logs, 50n, 35n), async (s) => void saves.push(s))).rejects.toThrow("rpc down");
    const saved = saves.at(-1)!;
    expect(saved.cursorBlock).toBe("30");
    const { state } = await refreshStats(saved, ctx(), fakeRpc(logs, 50n), async () => undefined);
    const full = await refreshStats(null, ctx(), fakeRpc(logs, 50n), async () => undefined);
    expect(state.totals).toEqual(full.state.totals);
  });

  it("stops at its time budget with the cursor saved, and is not caught up", async () => {
    let t = 0;
    const clock = () => new Date(Date.parse(T0) + (t += 1000));
    const { caughtUp, state } = await refreshStats(null, ctx({ now: clock, budgetMs: 1500 }), fakeRpc(logs, 50n), async () => undefined);
    expect(caughtUp).toBe(false);
    expect(isCaughtUp(state)).toBe(false);
    expect(state.updatedAt).toBe(state.builtAt);
  });

  it("counts nothing twice when nothing new has happened, and advances the as-of time", async () => {
    const first = await refreshStats(null, ctx(), fakeRpc(logs, 50n), async () => undefined);
    const later = ctx({ now: () => new Date("2026-09-25T11:00:00.000Z") });
    const again = await refreshStats(first.state, later, fakeRpc(logs, 50n), async () => undefined);
    expect(again.state.totals).toEqual(first.state.totals);
    expect(again.chunks).toBe(0);
    expect(again.state.updatedAt).toBe("2026-09-25T11:00:00.000Z");
  });
});

function memoryStore(initial: StatsState | null, lockFree = true): StatsStore & { stored: StoredStats } {
  const stored: StoredStats = { state: initial, lastError: null };
  return {
    stored,
    get: async () => ({ ...stored }),
    set: async (s) => void (stored.state = s),
    setError: async (message, at) => void (stored.lastError = { message, at }),
    clearError: async () => void (stored.lastError = null),
    lock: async () => (lockFree ? async () => undefined : null),
  };
}

describe("runStatsRefresh", () => {
  const c = { ...statsContext(CHAIN_ID, 60_000), startBlock: 1n };
  it("records and logs an error instead of hiding it, keeping saved progress", async () => {
    const store = memoryStore(null);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = { blockNumber: async () => 30_000n, getLogs: async () => { throw new Error("rpc down"); } };
    await expect(runStatsRefresh({ store, rpc, ctx: c })).rejects.toThrow("rpc down");
    expect(store.stored.lastError?.message).toBe("rpc down");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("doesn't run while another refresh holds the lock", async () => {
    const result = await runStatsRefresh({ store: memoryStore(null, false), rpc: fakeRpc([], 10n), ctx: c });
    expect(result).toEqual({ ran: false, reason: "another refresh is running" });
  });

  it("asks for a refresh when nothing is stored, when behind, or when older than the threshold", () => {
    const now = new Date("2026-09-25T10:05:00.000Z");
    const s = { ...emptyState(CHAIN_ID, 1n, T0), cursorBlock: "9", headBlock: "9" };
    expect(needsRefresh({ state: null, lastError: null }, now)).toBe(true);
    expect(needsRefresh({ state: s, lastError: null }, now)).toBe(false);
    expect(needsRefresh({ state: { ...s, headBlock: "20" }, lastError: null }, now)).toBe(true);
    expect(needsRefresh({ state: s, lastError: null }, new Date("2026-09-25T10:11:00.000Z"))).toBe(true);
  });
});

describe("createStatsRpc", () => {
  it("parses logs and falls back to the block timestamp when a log has none", async () => {
    const log = registered(1n, 16n);
    const responses: Record<string, unknown> = {
      eth_getLogs: [{ ...log, blockNumber: "0x10", logIndex: "0x2", blockTimestamp: undefined }],
      eth_getBlockByNumber: { timestamp: "0x64" },
    };
    const f = vi.fn(async (_u: unknown, init: { body: string }) => {
      const { method } = JSON.parse(init.body);
      return { ok: true, json: async () => ({ result: responses[method] }) } as Response;
    });
    const rpc = createStatsRpc("http://rpc", f as unknown as typeof fetch, 0);
    const [out] = await rpc.getLogs([CONTRACTS.registry], 1n, 20n);
    expect(out).toMatchObject({ blockNumber: 16n, logIndex: 2, blockTimestamp: 100 });
  });
});

describe("format", () => {
  it("shows exact figures below 10,000 and compact ones above, always with an exact form", () => {
    expect(formatCount(9_999)).toEqual({ value: "9,999", exact: "9,999" });
    expect(formatCount(12_400)).toEqual({ value: "12.4K", exact: "12,400" });
    expect(formatUsdc("1650000000")).toEqual({ value: "1,650.00 USDC", exact: "1,650.00 USDC" });
    expect(formatUsdc("12400123456")).toEqual({ value: "12.4K USDC", exact: "12,400.123456 USDC" });
  });
});

describe("buildStatsView", () => {
  const contracts = { registry: "0xR", settler: "0xS", ledger: "0xL" };
  const caughtUp = (): StatsState => ({ ...emptyState(CHAIN_ID, 1n, T0), cursorBlock: "9", headBlock: "9", firstEventAt: "2026-09-22T08:18:35.000Z" });
  const opts = (now = T0) => ({ now: new Date(now), staleAfterMs: 15 * 60_000, lastError: null });

  it("shows three headline figures with their sublines, and no operator line", () => {
    const view = buildStatsView(caughtUp(), contracts, opts());
    expect(view.headline.map((t) => t.label)).toEqual(["Invoices registered", "Value netted", "Loops settled"]);
    expect(view.headline[1]?.note).toBe(VALUE_NETTED_NOTE);
    expect(view.headline[2]?.note).toBe("0 invoice loops · 0 certificates · no tokens move");
    expect(JSON.stringify(view)).not.toMatch(/operator wallet|USDC moved/);
    expect(view.chainName).toBe("Arc testnet");
    expect(view.since).toBe("22 Sept 2026");
    expect(view.asOf).toBe("25 Sept 2026, 10:00 UTC");
    expect(view.staleness).toBeNull();
    expect(view.contracts.map((c) => c.url)).toEqual([
      "https://explorer.testnet.arc.io/address/0xR",
      "https://explorer.testnet.arc.io/address/0xS",
      "https://explorer.testnet.arc.io/address/0xL",
    ]);
  });

  it("says so when figures are old, still backfilling, or the last refresh failed", () => {
    expect(buildStatsView(caughtUp(), contracts, opts("2026-09-25T10:30:00.000Z")).staleness).toMatch(/Not updated for 30 minutes/);
    const behind = { ...caughtUp(), cursorBlock: "4", headBlock: "10" };
    expect(buildStatsView(behind, contracts, opts()).staleness).toMatch(/Still counting from the chain \(40% done\)/);
    const failed = buildStatsView(caughtUp(), contracts, { ...opts(), lastError: { message: "x", at: "2026-09-25T10:01:00.000Z" } });
    expect(failed.staleness).toMatch(/Retrying automatically/);
  });

  it("never uses claims-discipline words or rounded-up wording", () => {
    const copy = JSON.stringify(buildStatsView(caughtUp(), contracts, opts())).toLowerCase();
    for (const word of ["extinguish", "paid off", "discharge", "+", " over "]) expect(copy).not.toContain(word);
  });
});

describe("fetchContractLogsSince", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const item = (block: number, index: number, decoded = true) => ({
    transaction_hash: `0x${block}${index}`,
    block_number: block,
    index,
    block_timestamp: "2026-09-25T00:00:00.000000Z",
    decoded: decoded ? { method_call: "Settled()", parameters: [] } : null,
  });
  const page = (items: unknown[], next: unknown = null) => ({ ok: true, json: async () => ({ items, next_page_params: next }) }) as Response;

  it("stops at the cursor and reports the newest position, counting undecoded logs", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(page([item(9, 1, false), item(9, 0), item(8, 4)], { block_number: 8 })) as typeof fetch;
    const result = await fetchContractLogsSince(CHAIN_ID, "0xC", { blockNumber: 8, logIndex: 4 }, 5);
    expect(result.logs.map((l) => [l.blockNumber, l.logIndex])).toEqual([[9, 0]]);
    expect(result).toMatchObject({ undecoded: 1, newest: { blockNumber: 9, logIndex: 1 }, truncated: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("flags truncation when the page cap runs out first", async () => {
    global.fetch = vi.fn().mockResolvedValue(page([item(9, 0)], { block_number: 9 })) as typeof fetch;
    const result = await fetchContractLogsSince(CHAIN_ID, "0xC", null, 2);
    expect(result.truncated).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses a chain with no configured explorer", async () => {
    await expect(fetchContractLogsSince(5042, "0xC", null, 1)).rejects.toThrow(/No Blockscout explorer/);
  });
});
