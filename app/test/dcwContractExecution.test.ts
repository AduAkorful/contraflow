import { describe, expect, it, vi } from "vitest";

const createContractExecutionTransaction = vi.fn();
const getTransaction = vi.fn();

vi.mock("@circle-fin/developer-controlled-wallets", () => ({
  initiateDeveloperControlledWalletsClient: () => ({
    createContractExecutionTransaction,
    getTransaction,
  }),
}));

const { submitContractExecutionViaDcw, DcwTransactionFailedError, DcwTransactionTimeoutError } = await import(
  "../src/dcw/contractExecution"
);

const BASE_PARAMS = {
  apiKey: "TEST_API_KEY:id:secret",
  entitySecret: "a".repeat(64),
  walletId: "wallet-id",
  contractAddress: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312" as const,
  callData: "0x1234" as const,
  pollIntervalMs: 1,
};

describe("submitContractExecutionViaDcw", () => {
  it("returns txHash/blockNumber/gasPaidWei once the polled transaction reaches a terminal success state", async () => {
    createContractExecutionTransaction.mockResolvedValueOnce({ data: { id: "tx-1", state: "INITIATED" } });
    getTransaction
      .mockResolvedValueOnce({ data: { transaction: { state: "QUEUED" } } })
      .mockResolvedValueOnce({
        data: {
          transaction: { state: "CONFIRMED", txHash: "0xabc123", blockHeight: 42, networkFee: "0.01" },
        },
      });

    const result = await submitContractExecutionViaDcw(BASE_PARAMS);

    expect(result.txHash).toBe("0xabc123");
    expect(result.blockNumber).toBe(42n);
    expect(result.gasPaidWei).toBe(10_000_000_000_000_000n);
  });

  it("throws DcwTransactionFailedError with the error reason when the transaction fails", async () => {
    createContractExecutionTransaction.mockResolvedValueOnce({ data: { id: "tx-2", state: "INITIATED" } });
    getTransaction.mockResolvedValueOnce({
      data: { transaction: { state: "FAILED", errorReason: "insufficient funds" } },
    });

    await expect(submitContractExecutionViaDcw(BASE_PARAMS)).rejects.toThrow(DcwTransactionFailedError);
  });

  it("throws DcwTransactionTimeoutError when no terminal state is reached before the deadline", async () => {
    createContractExecutionTransaction.mockResolvedValueOnce({ data: { id: "tx-3", state: "INITIATED" } });
    getTransaction.mockResolvedValue({ data: { transaction: { state: "SENT" } } });

    await expect(submitContractExecutionViaDcw({ ...BASE_PARAMS, timeoutMs: 5 })).rejects.toThrow(
      DcwTransactionTimeoutError,
    );
  });
});
