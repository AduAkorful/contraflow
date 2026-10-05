import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

const mocks = vi.hoisted(() => ({ getSettlement: vi.fn(), getInvoicesForSettlement: vi.fn(), fetchTransactionFee: vi.fn(), fetchTransactionLogs: vi.fn(), getInvoice: vi.fn(), BlockscoutNotFoundError: class BlockscoutNotFoundError extends Error {} }));
const { getSettlement, getInvoicesForSettlement, fetchTransactionFee, fetchTransactionLogs, getInvoice } = mocks;
vi.mock("../src/chain/operatorEnv", () => ({ arcPublicClient: () => ({}) }));
vi.mock("../src/chain/readInvoices", () => ({ getInvoice: mocks.getInvoice }));
vi.mock("../src/db/invoices", () => ({ getSettlement: mocks.getSettlement, getInvoicesForSettlement: mocks.getInvoicesForSettlement }));
vi.mock("../src/blockscout/client", () => ({
  BlockscoutNotFoundError: mocks.BlockscoutNotFoundError,
  fetchTransactionFee: mocks.fetchTransactionFee,
  fetchTransactionLogs: mocks.fetchTransactionLogs,
  paramValue: (parameters: Array<{ name: string; value: string | string[] }>, name: string) => parameters.find((p) => p.name === name)?.value,
}));

import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import { getReceiptData } from "../src/receipt/getReceiptData";

const { registry, settler } = addressesForChain(ARC_TESTNET_CHAIN_ID);
const txHash = `0x${"ab".repeat(32)}`;
const invoiceId = `0x${"cd".repeat(32)}`;

function event(address: Address, methodCall: string, parameters: Array<{ name: string; value: string | string[] }>) {
  return { address, transactionHash: txHash, blockNumber: 10, methodCall, parameters };
}

function validReceiptEvents() {
  return [
    event(registry, "InvoiceNetted", [
      { name: "id", value: invoiceId }, { name: "wNet", value: "1000000" }, { name: "remainingAfter", value: "0" },
    ]),
    event(settler, "Settled", [
      { name: "invoiceIds", value: [invoiceId] }, { name: "wNet", value: "1000000" },
    ]),
  ];
}

describe("receipt data fallback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSettlement.mockResolvedValue(null);
    getInvoicesForSettlement.mockResolvedValue([]);
    fetchTransactionLogs.mockResolvedValue(validReceiptEvents());
    fetchTransactionFee.mockResolvedValue({ blockNumber: 10, gasPaidWei: "123" });
  });

  it("answers no settlement when the explorer doesn't know the transaction", async () => {
    fetchTransactionLogs.mockRejectedValue(new mocks.BlockscoutNotFoundError("no such transaction"));
    expect(await getReceiptData(txHash)).toBeNull();
    expect(fetchTransactionFee).not.toHaveBeenCalled();
  });

  it("still surfaces other explorer failures", async () => {
    fetchTransactionLogs.mockRejectedValue(new Error("Blockscout transaction logs fetch failed: 500"));
    await expect(getReceiptData(txHash)).rejects.toThrow("500");
  });

  it.each(["bad", "0x1234", `0x${"zz".repeat(32)}`, `${txHash}00`, ""])("answers no settlement for %j without touching the database or explorer", async (input) => {
    expect(await getReceiptData(input)).toBeNull();
    expect(getSettlement).not.toHaveBeenCalled();
    expect(fetchTransactionLogs).not.toHaveBeenCalled();
    expect(fetchTransactionFee).not.toHaveBeenCalled();
  });

  it("adds the invoice parties from the Registry when it falls back to explorer events", async () => {
    getInvoice.mockResolvedValue({ debtor: "0x00000000000000000000000000000000000000d1", creditor: "0x00000000000000000000000000000000000000c1" });
    const result = await getReceiptData(txHash);
    expect(result?.invoices[0]).toMatchObject({
      debtor: "0x00000000000000000000000000000000000000d1",
      creditor: "0x00000000000000000000000000000000000000c1",
    });
  });

  it("still returns the receipt, without parties, when the Registry read fails", async () => {
    getInvoice.mockRejectedValue(new Error("rpc down"));
    const result = await getReceiptData(txHash);
    expect(result?.invoices).toHaveLength(1);
    expect(result?.invoices[0]?.debtor).toBeUndefined();
  });

  it("falls back to authenticated Registry and Settler events when the DB read throws", async () => {
    getSettlement.mockRejectedValueOnce(new Error("database unavailable"));
    const result = await getReceiptData(txHash);
    expect(result?.invoices).toHaveLength(1);
    expect(result?.wNetUsdc).toBe("1.00");
  });

  it("does not treat a foreign emitter's InvoiceNetted event as a receipt", async () => {
    const valid = validReceiptEvents();
    fetchTransactionLogs.mockResolvedValueOnce([
      event("0x00000000000000000000000000000000000000aa", "InvoiceNetted", valid[0]!.parameters),
      valid[1],
    ]);
    expect(await getReceiptData(txHash)).toBeNull();
  });

  it("rejects partial event sets that disagree with the Settled aggregate", async () => {
    const valid = validReceiptEvents();
    fetchTransactionLogs.mockResolvedValueOnce([valid[0], event(settler, "Settled", [
      { name: "invoiceIds", value: [invoiceId, `0x${"ef".repeat(32)}`] }, { name: "wNet", value: "1000000" },
    ])]);
    expect(await getReceiptData(txHash)).toBeNull();
  });

  it("keeps a missing Circle network fee visibly unknown instead of formatting it as zero", async () => {
    getSettlement.mockResolvedValueOnce({
      settleTxHash: txHash, blockNumber: "10", wNetUsdc: "1.00", cycleLength: 1, gasPaidWei: null,
    });
    getInvoicesForSettlement.mockResolvedValueOnce([{
      invoiceRef: invoiceId, remainingUsdc: "0.00",
    }]);
    const result = await getReceiptData(txHash);
    expect(result?.gasPaidUsdc).toBeNull();
  });
});
