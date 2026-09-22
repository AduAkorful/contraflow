import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchContractLogs, fetchTransactionFee, fetchTransactionLogs, paramValue, MAX_RECONCILE_PAGES } from "../src/blockscout/client";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    json: async () => body,
  } as Response;
}

describe("paramValue", () => {
  it("finds a parameter by name among decoded log parameters", () => {
    const params = [
      { name: "id", type: "bytes32", value: "0xabc" },
      { name: "wNet", type: "uint256", value: "100" },
    ];
    expect(paramValue(params, "wNet")).toBe("100");
    expect(paramValue(params, "missing")).toBeUndefined();
  });
});

describe("fetchContractLogs", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("follows next_page_params across pages until exhausted", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ transaction_hash: "0x1", block_number: 1, decoded: { method_call: "Foo()", parameters: [] } }],
          next_page_params: { block_number: 1, index: 0 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ transaction_hash: "0x2", block_number: 2, decoded: { method_call: "Bar()", parameters: [] } }],
          next_page_params: null,
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const logs = await fetchContractLogs("0xRegistry");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logs.map((l) => l.transactionHash)).toEqual(["0x1", "0x2"]);
  });

  it("skips log items with no decoded data instead of throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        items: [
          { transaction_hash: "0x1", block_number: 1, decoded: null },
          { transaction_hash: "0x2", block_number: 2, decoded: { method_call: "Foo()", parameters: [] } },
        ],
        next_page_params: null,
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const logs = await fetchContractLogs("0xRegistry");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.transactionHash).toBe("0x2");
  });

  it("stops after MAX_RECONCILE_PAGES even if the server keeps returning next_page_params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [],
        next_page_params: { block_number: 1, index: 0 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchContractLogs("0xRegistry");
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RECONCILE_PAGES);
  });

  it("throws on a non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({}, false)) as unknown as typeof fetch;
    await expect(fetchContractLogs("0xRegistry")).rejects.toThrow(/Blockscout logs fetch failed/);
  });
});

describe("fetchTransactionFee / fetchTransactionLogs", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("extracts block number and fee value", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ block_number: 42, fee: { value: "1000000000000000" } })) as unknown as typeof fetch;
    const fee = await fetchTransactionFee("0xabc");
    expect(fee).toEqual({ blockNumber: 42, gasPaidWei: "1000000000000000" });
  });

  it("filters out logs with no decoded data", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        items: [
          { transaction_hash: "0x1", block_number: 1, decoded: null },
          { transaction_hash: "0x1", block_number: 1, decoded: { method_call: "Settled()", parameters: [] } },
        ],
      }),
    ) as unknown as typeof fetch;
    const logs = await fetchTransactionLogs("0x1");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.methodCall).toBe("Settled()");
  });
});
