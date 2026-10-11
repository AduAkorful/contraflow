import { afterEach, describe, expect, it, vi } from "vitest";
import { createStatsRpc } from "../src/stats/rpc";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function rpcOn(network: string, env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_ARC_NETWORK", network);
  for (const name of ["ARC_RPC", "ARC_TESTNET_RPC", "ARC_LOGS_RPC"]) vi.stubEnv(name, env[name] ?? "");
  return import("../src/chain/rpc");
}

describe("server RPC endpoints", () => {
  it("puts the configured endpoint first and Arc's public endpoints after it", async () => {
    const rpc = await rpcOn("mainnet", { ARC_RPC: "https://arc-mainnet.g.alchemy.com/v2/key" });
    expect(rpc.rpcUrlsFor(5042)).toEqual([
      "https://arc-mainnet.g.alchemy.com/v2/key",
      "https://rpc.mainnet.arc.io",
      "https://rpc.blockdaemon.mainnet.arc.io",
      "https://rpc.quicknode.mainnet.arc.io",
    ]);
  });

  it("never lets the keyed endpoint be a log source unless ARC_LOGS_RPC names it", async () => {
    const rpc = await rpcOn("mainnet", { ARC_RPC: "https://arc-mainnet.g.alchemy.com/v2/key" });
    expect(rpc.logsRpcUrlsFor(5042)[0]).toBe("https://rpc.mainnet.arc.io");
    expect(rpc.logsRpcUrlsFor(5042)).not.toContain("https://arc-mainnet.g.alchemy.com/v2/key");
    const own = await rpcOn("mainnet", { ARC_LOGS_RPC: "https://logs.example.com, https://b.example.com" });
    expect(own.logsRpcUrlsFor(5042).slice(0, 2)).toEqual(["https://logs.example.com", "https://b.example.com"]);
  });

  it("keeps testnet's own endpoint for the demo inside a mainnet deployment", async () => {
    const rpc = await rpcOn("mainnet", { ARC_RPC: "https://mainnet.example.com", ARC_TESTNET_RPC: "https://testnet.example.com" });
    expect(rpc.rpcUrlsFor(5042002)[0]).toBe("https://testnet.example.com");
    expect(rpc.rpcUrlsFor(5042)[0]).toBe("https://mainnet.example.com");
  });

  it("accepts ARC_TESTNET_RPC as the endpoint of a testnet deployment, and ignores non-https values", async () => {
    const rpc = await rpcOn("testnet", { ARC_TESTNET_RPC: "https://testnet.example.com" });
    expect(rpc.rpcUrlsFor(5042002)[0]).toBe("https://testnet.example.com");
    const bad = await rpcOn("testnet", { ARC_RPC: "http://insecure.example.com" });
    expect(bad.rpcUrlsFor(5042002)[0]).toBe("https://rpc.testnet.arc.io");
  });

  it("does not hand a mainnet endpoint to a testnet deployment for mainnet reads", async () => {
    const rpc = await rpcOn("testnet", { ARC_RPC: "https://testnet.example.com" });
    expect(rpc.rpcUrlsFor(5042)).toEqual([
      "https://rpc.mainnet.arc.io",
      "https://rpc.blockdaemon.mainnet.arc.io",
      "https://rpc.quicknode.mainnet.arc.io",
    ]);
  });
});

describe("stats RPC across endpoints", () => {
  function reply(result: unknown) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
  }

  it("moves to the next endpoint when one is rate limited", async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: string) => {
      seen.push(url);
      if (url === "https://a.example.com") return new Response("slow down", { status: 429 });
      return reply("0x10");
    });
    const rpc = createStatsRpc(["https://a.example.com", "https://b.example.com"], f as unknown as typeof fetch, 0);
    vi.useFakeTimers();
    const pending = rpc.blockNumber();
    await vi.runAllTimersAsync();
    expect(await pending).toBe(16n);
    vi.useRealTimers();
    expect(seen).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("refuses to start with no endpoint", () => {
    expect(() => createStatsRpc([])).toThrow();
  });
});
