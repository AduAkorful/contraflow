import { describe, expect, it, vi, beforeEach } from "vitest";

const hasReceivedStarterGrant = vi.fn();
const recordStarterGrant = vi.fn();
const getStarterGrantOperation = vi.fn();
const reserveStarterGrantOperation = vi.fn();
const markStarterGrantSubmitted = vi.fn();
const markStarterGrantUnknown = vi.fn();
const markStarterGrantReverted = vi.fn();
const completeStarterGrant = vi.fn();
const releaseUnsubmittedStarterGrant = vi.fn();
vi.mock("../src/db/addresses", () => ({
  hasReceivedStarterGrant, recordStarterGrant, getStarterGrantOperation, reserveStarterGrantOperation,
  markStarterGrantSubmitted, markStarterGrantUnknown, markStarterGrantReverted, completeStarterGrant,
  releaseUnsubmittedStarterGrant,
}));

const checkRateLimit = vi.fn();
const incrementWindowCounter = vi.fn();
vi.mock("../src/ratelimit/limiter", () => ({ checkRateLimit, incrementWindowCounter }));

const getBalance = vi.fn();
const waitForTransactionReceipt = vi.fn();
const getTransactionReceipt = vi.fn();
const sendTransaction = vi.fn();
const arcPublicClient = vi.fn(() => ({ getBalance, waitForTransactionReceipt, getTransactionReceipt }));
const operatorSigner = vi.fn(() => ({
  kind: "raw-key",
  walletClient: { account: { address: "0xOperator" }, chain: undefined, sendTransaction },
}));
vi.mock("../src/chain/operatorEnv", () => ({ arcPublicClient, operatorSigner }));

const { requestStarterGrant } = await import("../src/attest/starterGrant");

const RECIPIENT = "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C" as const;

describe("requestStarterGrant", () => {
  beforeEach(() => {
    hasReceivedStarterGrant.mockReset();
    recordStarterGrant.mockReset();
    getStarterGrantOperation.mockReset();
    reserveStarterGrantOperation.mockReset();
    markStarterGrantSubmitted.mockReset();
    markStarterGrantUnknown.mockReset();
    markStarterGrantReverted.mockReset();
    completeStarterGrant.mockReset();
    releaseUnsubmittedStarterGrant.mockReset();
    checkRateLimit.mockReset();
    incrementWindowCounter.mockReset();
    getBalance.mockReset();
    waitForTransactionReceipt.mockReset();
    getTransactionReceipt.mockReset();
    sendTransaction.mockReset();

    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 2, count: 1 });
    incrementWindowCounter.mockResolvedValue(1);
    getBalance.mockResolvedValue(10n ** 18n); // 1 native USDC — well above the floor
    getStarterGrantOperation.mockResolvedValue(null);
    reserveStarterGrantOperation.mockResolvedValue({ reserved: true, operation: { status: "reserved", txHash: null } });
  });

  it("is idempotent — already-granted addresses short-circuit with no transfer", async () => {
    hasReceivedStarterGrant.mockResolvedValueOnce(true);
    const result = await requestStarterGrant(RECIPIENT);
    expect(result).toEqual({ ok: true, alreadyGranted: true });
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the per-address rate limit is exceeded", async () => {
    hasReceivedStarterGrant.mockResolvedValueOnce(false);
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, count: 4 });
    const result = await requestStarterGrant(RECIPIENT);
    expect(result.ok).toBe(false);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects once the daily spend cap would be exceeded", async () => {
    hasReceivedStarterGrant.mockResolvedValueOnce(false);
    // $0.05 default grant amount; a count of 21 * 0.05 = $1.05 > the $1 cap.
    incrementWindowCounter.mockResolvedValueOnce(21);
    const result = await requestStarterGrant(RECIPIENT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/daily/i);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("sends a real transfer and records it on success", async () => {
    hasReceivedStarterGrant.mockResolvedValueOnce(false);
    sendTransaction.mockResolvedValueOnce("0xgranttx");
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "success" });
    markStarterGrantSubmitted.mockResolvedValue(undefined);
    completeStarterGrant.mockResolvedValue(undefined);

    const result = await requestStarterGrant(RECIPIENT);

    expect(result).toEqual({ ok: true, alreadyGranted: false, txHash: "0xgranttx" });
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: RECIPIENT }),
    );
    expect(markStarterGrantSubmitted).toHaveBeenCalledWith(RECIPIENT, "0xgranttx");
    expect(completeStarterGrant).toHaveBeenCalledWith(RECIPIENT, "0xgranttx");
  });

  it("reports a reverted grant transfer as a failure, without recording it", async () => {
    hasReceivedStarterGrant.mockResolvedValueOnce(false);
    sendTransaction.mockResolvedValueOnce("0xgranttx");
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    markStarterGrantSubmitted.mockResolvedValue(undefined);

    const result = await requestStarterGrant(RECIPIENT);

    expect(result.ok).toBe(false);
    expect(markStarterGrantReverted).toHaveBeenCalledWith(RECIPIENT);
    expect(recordStarterGrant).not.toHaveBeenCalled();
  });

  it("still attempts the transfer under a low operator balance — alerts, doesn't block (no auto top-up)", async () => {
    hasReceivedStarterGrant.mockResolvedValueOnce(false);
    getBalance.mockResolvedValueOnce(1n); // far under the floor
    sendTransaction.mockResolvedValueOnce("0xgranttx");
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "success" });
    markStarterGrantSubmitted.mockResolvedValue(undefined);
    completeStarterGrant.mockResolvedValue(undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requestStarterGrant(RECIPIENT);

    expect(result.ok).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("ALERT"));
    consoleErrorSpy.mockRestore();
  });

  it("never submits twice when a prior request has a transaction hash but no receipt yet", async () => {
    getStarterGrantOperation.mockResolvedValueOnce({ status: "submitted", txHash: "0xprior" });
    getTransactionReceipt.mockRejectedValueOnce(new Error("receipt unavailable"));
    const result = await requestStarterGrant(RECIPIENT);
    expect(result.ok).toBe(false);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("reconciles a previously submitted successful transfer without sending again", async () => {
    getStarterGrantOperation.mockResolvedValueOnce({ status: "submitted", txHash: "0xprior" });
    getTransactionReceipt.mockResolvedValueOnce({ status: "success" });
    const result = await requestStarterGrant(RECIPIENT);
    expect(result).toEqual({ ok: true, alreadyGranted: true, txHash: "0xprior" });
    expect(completeStarterGrant).toHaveBeenCalledWith(RECIPIENT, "0xprior");
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});
