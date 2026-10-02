import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicClient, defineChain } from "viem";
import { chainCheckedHttpTransport } from "../src/kits/appkit";

const chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
});

afterEach(() => vi.unstubAllGlobals());

describe("chainCheckedHttpTransport", () => {
  it("checks the configured endpoint before forwarding the first RPC request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      expect(request.method).toBe("eth_chainId");
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x4cef52" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createPublicClient({
      chain,
      transport: chainCheckedHttpTransport("https://rpc.example", chain.id),
    });
    await expect(client.getChainId()).resolves.toBe(chain.id);
    expect(fetchMock).toHaveBeenCalledTimes(2); // preflight, then the requested eth_chainId
  });

  it("rejects a mismatched endpoint before sending the requested operation", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ method: "eth_chainId" });
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x13882" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createPublicClient({
      chain,
      transport: chainCheckedHttpTransport("https://wrong-chain.example", chain.id),
    });
    await expect(client.getChainId()).rejects.toThrow(/Configured RPC for chain 5042002 reports chain 80002/);
    expect(fetchMock).toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(String(init?.body))).toMatchObject({ method: "eth_chainId" });
  });
});
