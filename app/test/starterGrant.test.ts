import { describe, expect, it, vi, beforeEach } from "vitest";

const hasReceivedStarterGrant = vi.fn();
const recordStarterGrant = vi.fn();
vi.mock("../src/db/addresses", () => ({ hasReceivedStarterGrant, recordStarterGrant }));

const checkRateLimit = vi.fn();
const incrementWindowCounter = vi.fn();
vi.mock("../src/ratelimit/limiter", () => ({ checkRateLimit, incrementWindowCounter }));

const getBalance = vi.fn();
const waitForTransactionReceipt = vi.fn();
const sendTransaction = vi.fn();
const arcPublicClient = vi.fn(() => ({ getBalance, waitForTransactionReceipt }));
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
    checkRateLimit.mockReset();
    incrementWindowCounter.mockReset();
    getBalance.mockReset();
    waitForTransactionReceipt.mockReset();
    sendTransaction.mockReset();

    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 2, count: 1 });
    incrementWindowCounter.mockResolvedValue(1);
    getBalance.mockResolvedValue(10n ** 18n); // 1 native USDC — well above the floor
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

    const result = await requestStarterGrant(RECIPIENT);

    expect(result).toEqual({ ok: true, alreadyGranted: false, txHash: "0xgranttx" });
    expect(sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: RECIPIENT }),
    );
    expect(recordStarterGrant).toHaveBeenCalledWith(RECIPIENT, "0xgranttx");
  });

  it("reports a reverted grant transfer as a failure, without recording it", async () => {
    hasReceivedStarterGrant.mockResolvedValueOnce(false);
    sendTransaction.mockResolvedValueOnce("0xgranttx");
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });

    const result = await requestStarterGrant(RECIPIENT);

    expect(result.ok).toBe(false);
    expect(recordStarterGrant).not.toHaveBeenCalled();
  });

  it("still attempts the transfer under a low operator balance — alerts, doesn't block (plan 14: no auto top-up)", async () => {
    hasReceivedStarterGrant.mockResolvedValueOnce(false);
    getBalance.mockResolvedValueOnce(1n); // far under the floor
    sendTransaction.mockResolvedValueOnce("0xgranttx");
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "success" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requestStarterGrant(RECIPIENT);

    expect(result.ok).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("ALERT"));
    consoleErrorSpy.mockRestore();
  });
});
