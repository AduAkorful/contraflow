import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchContractLogsSince, type LogPosition, type LogsSince, type PositionedLog } from "../src/blockscout/client";
import { emptyState, foldEvents, type AttributedEvent, type StatsState } from "../src/stats/aggregate";
import { parseStatsEvent, UnrecognisedStatsEvent } from "../src/stats/events";
import { STATS_MAX_PAGES, updateStats, type IndexerContext, type IndexerDeps } from "../src/stats/indexer";
import { loadStats, StatsUnavailableError, type StatsStore } from "../src/stats/load";
import { formatCount, formatGas, formatUsdc } from "../src/stats/format";
import { buildStatsView } from "../src/stats/view";

const OPERATOR = "0x74B4134C8d527a8D8AE8cb9503ab2043bCfC0ffd";
const PARTY_A = "0xCFd6d6ab5128Da8960882921ff36EC0bBe65adEB";
const PARTY_B = "0xB76FF3Cb47747590558A4240aB5dadE181331911";
const OPERATORS = new Set([OPERATOR.toLowerCase()]);
const CHAIN_ID = 5042002;
const T0 = "2026-09-25T10:00:00.000Z";

let nextIndex = 0;
function log(methodCall: string, params: [string, string | string[]][], opts: Partial<PositionedLog> = {}): PositionedLog {
  return {
    transactionHash: opts.transactionHash ?? `0xtx${nextIndex}`,
    blockNumber: opts.blockNumber ?? 100,
    logIndex: opts.logIndex ?? nextIndex++,
    blockTimestamp: opts.blockTimestamp ?? "2026-09-23T10:02:00.000000Z",
    methodCall,
    parameters: params.map(([name, value]) => ({ name, type: "", value })),
  };
}

const registeredLog = (amount: string, opts: Partial<PositionedLog> = {}, debtor = PARTY_A, creditor = PARTY_B) =>
  log(
    "InvoiceRegistered(bytes32 indexed id, address indexed debtor, address indexed creditor, uint256 amount, uint64 maturity, bool earlyNetConsent, uint256 nonce)",
    [
      ["id", "0x01"],
      ["debtor", debtor],
      ["creditor", creditor],
      ["amount", amount],
      ["maturity", "1792749720"],
      ["earlyNetConsent", "true"],
      ["nonce", "1"],
    ],
    opts,
  );
const nettedLog = (wNet: string, status: string, opts: Partial<PositionedLog> = {}) =>
  log(
    "InvoiceNetted(bytes32 indexed id, uint256 wNet, uint256 remainingAfter, uint8 status)",
    [
      ["id", "0x01"],
      ["wNet", wNet],
      ["remainingAfter", "0"],
      ["status", status],
    ],
    opts,
  );
const settledLog = (opts: Partial<PositionedLog> = {}) =>
  log("Settled(bytes32[] invoiceIds, uint256 wNet, address indexed caller)", [["invoiceIds", ["0x01"]]], opts);
const certificateLog = (opts: Partial<PositionedLog> = {}) =>
  log("CertificateApplied(bytes32 indexed certificateId, bytes32 contentHash, address indexed submitter)", [], opts);
const advancedLog = (opts: Partial<PositionedLog> = {}) =>
  log("ObligationAdvanced(bytes32 indexed obligationKey, bytes32 indexed certificateId, bytes32 priorCommitment, bytes32 nextCommitment)", [], opts);

function attributed(l: PositionedLog, contract: "registry" | "settler" | "ledger", from: string, feeWei = "0"): AttributedEvent {
  return { event: parseStatsEvent(contract, l)!, tx: { from, feeWei } };
}

describe("parseStatsEvent", () => {
  it("ignores proxy admin events", () => {
    expect(parseStatsEvent("registry", log("Upgraded(address indexed implementation)", []))).toBeNull();
    expect(parseStatsEvent("ledger", log("Initialized(uint64 version)", []))).toBeNull();
  });

  it("throws on an event it doesn't know rather than dropping it", () => {
    expect(() => parseStatsEvent("settler", log("Mystery()", []))).toThrow(UnrecognisedStatsEvent);
    expect(() => parseStatsEvent("registry", settledLog())).toThrow(UnrecognisedStatsEvent);
  });

  it("reads InvoiceNetted status 1 as fully netted", () => {
    expect(parseStatsEvent("registry", nettedLog("5", "1"))).toMatchObject({ kind: "netted", wNet: 5n, fullyNetted: true });
    expect(parseStatsEvent("registry", nettedLog("5", "0"))).toMatchObject({ fullyNetted: false });
  });
});

describe("foldEvents", () => {
  it("sums every figure, keeping 6- and 18-decimal amounts apart", () => {
    const state = foldEvents(
      emptyState(CHAIN_ID, T0),
      [
        attributed(registeredLog("2950000000"), "registry", PARTY_A),
        attributed(registeredLog("1000000", {}, PARTY_B, PARTY_A), "registry", PARTY_B),
        attributed(nettedLog("1650000000", "0"), "registry", PARTY_A),
        attributed(nettedLog("1000000", "1"), "registry", PARTY_A),
        attributed(settledLog(), "settler", PARTY_A, "2502275000000000"),
        attributed(certificateLog(), "ledger", PARTY_B, "1000000000000000"),
        attributed(advancedLog(), "ledger", PARTY_B),
        attributed(advancedLog(), "ledger", PARTY_B),
      ],
      OPERATORS,
    );
    expect(state.totals).toEqual({
      invoicesRegistered: 2,
      faceValueRegistered: "2951000000",
      valueNetted: "1651000000",
      fullyNetted: 1,
      invoiceLoopsSettled: 1,
      certificatesApplied: 1,
      obligationUpdates: 2,
      gasPaidWei: "3502275000000000",
    });
  });

  it("counts parties once each, case-insensitively", () => {
    const state = foldEvents(
      emptyState(CHAIN_ID, T0),
      [
        attributed(registeredLog("1", {}, PARTY_A, PARTY_B), "registry", PARTY_A),
        attributed(registeredLog("1", {}, PARTY_B.toLowerCase(), PARTY_A.toUpperCase().replace("0X", "0x")), "registry", PARTY_B),
      ],
      OPERATORS,
    );
    expect(state.parties).toHaveLength(2);
  });

  it("moves operator-sent activity to the demo totals and out of every headline figure", () => {
    const state = foldEvents(
      emptyState(CHAIN_ID, T0),
      [
        attributed(registeredLog("100", {}, "0x0000000000000000000000000000000000000001"), "registry", OPERATOR.toLowerCase()),
        attributed(nettedLog("100", "1"), "registry", OPERATOR),
        attributed(settledLog(), "settler", OPERATOR, "999"),
        attributed(registeredLog("7"), "registry", PARTY_A),
      ],
      OPERATORS,
    );
    expect(state.demo).toEqual({ invoicesRegistered: 1, loopsSettled: 1 });
    expect(state.totals.invoicesRegistered).toBe(1);
    expect(state.totals.faceValueRegistered).toBe("7");
    expect(state.totals.valueNetted).toBe("0");
    expect(state.totals.invoiceLoopsSettled).toBe(0);
    expect(state.totals.gasPaidWei).toBe("0");
    expect(state.parties).not.toContain("0x0000000000000000000000000000000000000001");
  });

  it("tracks the earliest non-demo event as the window start", () => {
    const state = foldEvents(
      emptyState(CHAIN_ID, T0),
      [
        attributed(registeredLog("1", { blockTimestamp: "2026-09-20T00:00:00.000000Z" }), "registry", OPERATOR),
        attributed(registeredLog("1", { blockTimestamp: "2026-09-23T00:00:00.000000Z" }), "registry", PARTY_A),
        attributed(registeredLog("1", { blockTimestamp: "2026-09-22T00:00:00.000000Z" }), "registry", PARTY_A),
      ],
      OPERATORS,
    );
    expect(state.firstEventAt).toBe("2026-09-22T00:00:00.000000Z");
  });
});

function ctx(): IndexerContext {
  return { chainId: CHAIN_ID, contracts: { registry: "R", settler: "S", ledger: "L" }, operators: OPERATORS, now: T0 };
}

/// In-memory explorer: every contract's logs newest-first, served with the same cursor and page-cap
/// rules as the real client.
function fakeExplorer(logsByContract: Record<string, PositionedLog[]>, pageSize = 50) {
  const txCalls: string[] = [];
  const deps: IndexerDeps = {
    async fetchLogs(contract, since, maxPages) {
      const all = [...(logsByContract[contract] ?? [])].sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
      const after = since
        ? all.filter((l) => l.blockNumber > since.blockNumber || (l.blockNumber === since.blockNumber && l.logIndex > since.logIndex))
        : all;
      const cap = maxPages * pageSize;
      const logs = after.slice(0, cap);
      const newest: LogPosition | null = logs[0] ? { blockNumber: logs[0].blockNumber, logIndex: logs[0].logIndex } : null;
      return { logs, undecoded: 0, newest, truncated: after.length > cap } satisfies LogsSince;
    },
    async fetchTransaction(txHash) {
      txCalls.push(txHash);
      return { from: txHash.startsWith("0xdemo") ? OPERATOR : PARTY_A, feeWei: "10" };
    },
  };
  return { deps, txCalls };
}

describe("updateStats", () => {
  it("builds from nothing, then reads only what's new", async () => {
    const registry = [registeredLog("5", { blockNumber: 1, logIndex: 0, transactionHash: "0xa" })];
    const { deps, txCalls } = fakeExplorer({ R: registry });
    const first = await updateStats(null, ctx(), deps);
    expect(first.totals.invoicesRegistered).toBe(1);
    expect(first.cursors.registry).toEqual({ blockNumber: 1, logIndex: 0 });

    registry.push(registeredLog("6", { blockNumber: 2, logIndex: 0, transactionHash: "0xb" }));
    const second = await updateStats(first, { ...ctx(), now: "2026-09-25T10:05:00.000Z" }, deps);
    expect(second.totals.invoicesRegistered).toBe(2);
    expect(second.totals.faceValueRegistered).toBe("11");
    expect(second.builtAt).toBe(T0);
    expect(txCalls).toEqual(["0xa", "0xb"]);
  });

  it("counts nothing twice when nothing new has happened", async () => {
    const { deps } = fakeExplorer({ R: [registeredLog("5", { blockNumber: 1, logIndex: 3 })] });
    const first = await updateStats(null, ctx(), deps);
    const again = await updateStats(first, ctx(), deps);
    expect(again.totals).toEqual(first.totals);
    expect(again.cursors).toEqual(first.cursors);
  });

  it("marks a first build that hit the page cap as a lower bound", async () => {
    const many = Array.from({ length: STATS_MAX_PAGES * 2 + 1 }, (_, i) => registeredLog("1", { blockNumber: i + 1, logIndex: 0 }));
    const { deps } = fakeExplorer({ R: many }, 2);
    const state = await updateStats(null, ctx(), deps);
    expect(state.lowerBound).toBe(true);
    expect(state.totals.invoicesRegistered).toBe(STATS_MAX_PAGES * 2);
  });

  it("rebuilds rather than skip a gap too large to page through", async () => {
    const registry = [registeredLog("1", { blockNumber: 1, logIndex: 0 })];
    const small = fakeExplorer({ R: registry }, 1);
    const first = await updateStats(null, ctx(), small.deps);
    for (let i = 0; i < STATS_MAX_PAGES + 1; i++) registry.push(registeredLog("1", { blockNumber: i + 2, logIndex: 0 }));
    const next = await updateStats(first, { ...ctx(), now: "2026-09-26T00:00:00.000Z" }, small.deps);
    expect(next.builtAt).toBe("2026-09-26T00:00:00.000Z");
    expect(next.lowerBound).toBe(true);
  });

  it("looks each transaction up once even when it emitted several events", async () => {
    const { deps, txCalls } = fakeExplorer({
      R: [nettedLog("1", "1", { transactionHash: "0xs", blockNumber: 5, logIndex: 1 }), nettedLog("1", "1", { transactionHash: "0xs", blockNumber: 5, logIndex: 2 })],
      S: [settledLog({ transactionHash: "0xs", blockNumber: 5, logIndex: 3 })],
    });
    const state = await updateStats(null, ctx(), deps);
    expect(txCalls).toEqual(["0xs"]);
    expect(state.totals.gasPaidWei).toBe("10");
  });
});

function memoryStore(initial: StatsState | null, lockFree = true): StatsStore & { saved: StatsState | null } {
  const store = {
    saved: initial,
    get: async () => store.saved,
    set: async (s: StatsState) => {
      store.saved = s;
    },
    lock: async () => lockFree,
    unlock: async () => {},
  };
  return store;
}

describe("loadStats", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");
  const stateAt = (updatedAt: string, builtAt = updatedAt): StatsState => ({ ...emptyState(CHAIN_ID, updatedAt), builtAt });

  it("serves fresh stored stats without refreshing", async () => {
    const stored = stateAt("2026-09-25T11:59:30.000Z");
    const update = vi.fn();
    expect(await loadStats(memoryStore(stored), update, now)).toBe(stored);
    expect(update).not.toHaveBeenCalled();
  });

  it("refreshes stale stats incrementally and stores the result", async () => {
    const stored = stateAt("2026-09-25T11:00:00.000Z");
    const store = memoryStore(stored);
    const fresh = stateAt("2026-09-25T12:00:00.000Z");
    const update = vi.fn().mockResolvedValue(fresh);
    expect(await loadStats(store, update, now)).toBe(fresh);
    expect(update).toHaveBeenCalledWith(stored);
    expect(store.saved).toBe(fresh);
  });

  it("rebuilds from nothing once the last full build is a day old", async () => {
    const stored = stateAt("2026-09-25T11:00:00.000Z", "2026-09-24T11:00:00.000Z");
    const update = vi.fn().mockResolvedValue(stored);
    await loadStats(memoryStore(stored), update, now);
    expect(update).toHaveBeenCalledWith(null);
  });

  it("keeps serving stored stats, with their real time, when a refresh fails", async () => {
    const stored = stateAt("2026-09-25T09:00:00.000Z");
    const result = await loadStats(memoryStore(stored), vi.fn().mockRejectedValue(new Error("explorer down")), now);
    expect(result).toBe(stored);
    expect(result.updatedAt).toBe("2026-09-25T09:00:00.000Z");
  });

  it("reports unavailable, never an empty state, when nothing is stored and the build fails", async () => {
    await expect(loadStats(memoryStore(null), vi.fn().mockRejectedValue(new Error("explorer down")), now)).rejects.toThrow(
      StatsUnavailableError,
    );
  });

  it("serves stored stats when another request holds the refresh lock", async () => {
    const stored = stateAt("2026-09-25T09:00:00.000Z");
    const update = vi.fn();
    expect(await loadStats(memoryStore(stored, false), update, now)).toBe(stored);
    expect(update).not.toHaveBeenCalled();
    await expect(loadStats(memoryStore(null, false), update, now)).rejects.toThrow(StatsUnavailableError);
  });
});

describe("format", () => {
  it("shows exact figures below 10,000 and compact ones above, always with an exact form", () => {
    expect(formatCount(9_999)).toEqual({ value: "9,999", exact: "9,999" });
    expect(formatCount(12_400)).toEqual({ value: "12.4K", exact: "12,400" });
    expect(formatUsdc("1650000000")).toEqual({ value: "1,650.00 USDC", exact: "1,650.00 USDC" });
    expect(formatUsdc("12400123456")).toEqual({ value: "12.4K USDC", exact: "12,400.123456 USDC" });
  });

  it("keeps small gas totals readable", () => {
    expect(formatGas("2502275000000000")).toEqual({ value: "0.0025 USDC", exact: "0.002502275 USDC" });
    expect(formatGas("0").value).toBe("0 USDC");
  });
});

describe("buildStatsView", () => {
  const contracts = { registry: "0xR", settler: "0xS", ledger: "0xL" };

  it("labels testnet, links every contract and notes demo activity separately", () => {
    const state: StatsState = {
      ...emptyState(CHAIN_ID, T0),
      demo: { invoicesRegistered: 12, loopsSettled: 1 },
      firstEventAt: "2026-09-22T08:18:35.000000Z",
    };
    const view = buildStatsView(state, contracts);
    expect(view.chainName).toBe("Arc testnet");
    expect(view.since).toBe("22 Sept 2026");
    expect(view.asOf).toBe("25 Sept 2026, 10:00 UTC");
    expect(view.demoNote).toBe("Plus 12 invoices and 1 loop sent from Contraflow's operator wallet (the live demo and our own test runs), not counted above.");
    expect(view.contracts.map((c) => c.url)).toEqual([
      "https://explorer.testnet.arc.io/address/0xR",
      "https://explorer.testnet.arc.io/address/0xS",
      "https://explorer.testnet.arc.io/address/0xL",
    ]);
    expect(view.headline.map((t) => t.label)).toEqual([
      "Invoices registered",
      "Value netted",
      "Loops settled",
      "USDC moved by settlement",
    ]);
  });

  it("words every figure as a lower bound when the history was truncated", () => {
    const view = buildStatsView({ ...emptyState(CHAIN_ID, T0), lowerBound: true }, contracts);
    expect(view.headline[0]).toMatchObject({ value: "At least 0", exact: "At least 0" });
    // "USDC moved" is 0 by construction, not counted, so it's never a lower bound.
    expect(view.headline[3]?.value).toBe("0 USDC");
  });

  it("never uses claims-discipline words or rounded-up wording", () => {
    const view = buildStatsView({ ...emptyState(CHAIN_ID, T0), demo: { invoicesRegistered: 1, loopsSettled: 1 } }, contracts);
    const copy = JSON.stringify(view).toLowerCase();
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
