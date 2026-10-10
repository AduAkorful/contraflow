import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const checkRateLimit = vi.fn();
const redisGet = vi.fn();
const redisSet = vi.fn();
const fetchContractLogsBounded = vi.fn();
const fetchNettableInvoiceEdges = vi.fn();
const filterFlaggedInvoices = vi.fn();
const getReceiptData = vi.fn();
const fetchTransactionFee = vi.fn();
const upsertSettledInvoice = vi.fn();
const upsertSettlement = vi.fn();

vi.mock("../src/session/getSession", () => ({ getSession }));
vi.mock("../src/ratelimit/limiter", () => ({ checkRateLimit }));
vi.mock("../src/upstash/client", () => ({ redis: () => ({ get: redisGet, set: redisSet }) }));
vi.mock("../src/blockscout/client", () => ({ fetchContractLogsBounded, fetchTransactionFee }));
vi.mock("../src/chain/readInvoices", () => ({ fetchNettableInvoiceEdges }));
vi.mock("../src/compliance", () => ({
  defaultComplianceProvider: () => ({}),
  filterFlaggedInvoices,
}));
vi.mock("../src/chain/operatorEnv", () => ({ arcPublicClient: () => ({}) }));
vi.mock("../src/receipt/getReceiptData", () => ({ getReceiptData }));
vi.mock("../src/db/invoices", () => ({ upsertSettledInvoice, upsertSettlement }));

const { findSettleableLoop, recordSettlement } = await import("../src/app/app/settle/actions");

const ME = "0x0000000000000000000000000000000000000001";
const HASH = `0x${"ab".repeat(32)}`;

describe("findSettleableLoop", () => {
  beforeEach(() => {
    for (const fn of [getSession, checkRateLimit, redisGet, redisSet, fetchContractLogsBounded, fetchNettableInvoiceEdges, filterFlaggedInvoices]) {
      fn.mockReset();
    }
    checkRateLimit.mockResolvedValue({ allowed: true });
    redisGet.mockResolvedValue(null);
    redisSet.mockResolvedValue("OK");
    filterFlaggedInvoices.mockImplementation(async (edges: unknown[]) => ({ clearInvoices: edges, flagged: [] }));
    fetchNettableInvoiceEdges.mockResolvedValue([]);
  });

  it("uses the session address, never a client value", async () => {
    getSession.mockResolvedValueOnce({ address: ME });
    fetchContractLogsBounded.mockResolvedValueOnce({ logs: [], truncated: false });
    await findSettleableLoop();
    expect(checkRateLimit).toHaveBeenCalledWith(`settle:loop:${ME}`, 10, 60);
  });

  it("fails closed when the caller is signed out", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(findSettleableLoop()).resolves.toEqual({ kind: "error", error: "Sign in first." });
    expect(fetchContractLogsBounded).not.toHaveBeenCalled();
  });

  it("fails closed when the rate limiter is down", async () => {
    getSession.mockResolvedValueOnce({ address: ME });
    checkRateLimit.mockRejectedValueOnce(new Error("down"));
    await expect(findSettleableLoop()).resolves.toEqual({ kind: "error", error: "Couldn't check for loops right now." });
  });

  it("answers an error, never a rejection, when the chain read fails mid-search", async () => {
    getSession.mockResolvedValueOnce({ address: ME });
    const B = "0x0000000000000000000000000000000000000002";
    const C = "0x0000000000000000000000000000000000000003";
    const registered = (n: number, debtor: string, creditor: string) => ({
      blockNumber: n,
      logIndex: 0,
      methodCall: "InvoiceRegistered(bytes32 id, address debtor, address creditor, uint256 amount, uint64 maturity, bool earlyNetConsent, uint256 nonce)",
      parameters: [
        { name: "id", value: `0x${String(n).repeat(64)}` },
        { name: "debtor", value: debtor },
        { name: "creditor", value: creditor },
        { name: "amount", value: "1000000" },
        { name: "maturity", value: "1" },
        { name: "earlyNetConsent", value: "true" },
        { name: "nonce", value: "1" },
      ],
    });
    fetchContractLogsBounded.mockResolvedValueOnce({ logs: [registered(1, ME, B), registered(2, B, C), registered(3, C, ME)], truncated: false });
    fetchNettableInvoiceEdges.mockRejectedValueOnce(new Error("rpc down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    await expect(findSettleableLoop()).resolves.toEqual({ kind: "error", error: "Couldn't check for loops right now." });
  });

  it("reports truncated history as incomplete when the log scan fails", async () => {
    getSession.mockResolvedValueOnce({ address: ME });
    fetchContractLogsBounded.mockRejectedValueOnce(new Error("explorer down"));
    await expect(findSettleableLoop()).resolves.toEqual({ kind: "incomplete" });
  });
});

describe("recordSettlement", () => {
  beforeEach(() => {
    for (const fn of [getSession, getReceiptData, fetchTransactionFee, upsertSettledInvoice, upsertSettlement]) fn.mockReset();
    getSession.mockResolvedValue({ address: ME });
  });

  it("rejects a hash that is not a transaction", async () => {
    await expect(recordSettlement("nope")).resolves.toEqual({ ok: false, error: "Not a settlement transaction." });
    expect(getReceiptData).not.toHaveBeenCalled();
  });

  it("rejects a transaction with no settlement evidence", async () => {
    getReceiptData.mockResolvedValueOnce(null);
    await expect(recordSettlement(HASH)).resolves.toEqual({ ok: false, error: "No settlement found for that transaction." });
    expect(upsertSettlement).not.toHaveBeenCalled();
  });

  it("rejects a reverted transaction (it carries no settlement events)", async () => {
    getReceiptData.mockResolvedValueOnce(null);
    await expect(recordSettlement(HASH)).resolves.toEqual({ ok: false, error: "No settlement found for that transaction." });
    expect(upsertSettledInvoice).not.toHaveBeenCalled();
  });

  it("writes nothing when no row names its parties", async () => {
    getReceiptData.mockResolvedValueOnce({
      wNetUsdc: "40.00",
      blockNumber: "1",
      invoices: [{ invoiceId: HASH, afterUsdc: "10.00" }],
    });
    await expect(recordSettlement(HASH)).resolves.toEqual({ ok: false, error: "Couldn't confirm this settlement yet." });
    expect(upsertSettlement).not.toHaveBeenCalled();
  });

  it("records a settlement the session address is in", async () => {
    getReceiptData.mockResolvedValueOnce({
      wNetUsdc: "40.00",
      blockNumber: "1",
      invoices: [{ invoiceId: HASH, afterUsdc: "10.00", debtor: ME, creditor: "0x0000000000000000000000000000000000000002" }],
    });
    fetchTransactionFee.mockResolvedValueOnce({ gasPaidWei: "1" });
    await expect(recordSettlement(HASH)).resolves.toEqual({ ok: true });
    expect(upsertSettlement).toHaveBeenCalledWith(expect.objectContaining({ settleTxHash: HASH, cycleLength: 1, gasPaidWei: "1" }));
  });

  it("rejects a settlement the session address is not in", async () => {
    getReceiptData.mockResolvedValueOnce({
      wNetUsdc: "40.00",
      blockNumber: "1",
      invoices: [{ invoiceId: HASH, afterUsdc: "10.00", debtor: "0x0000000000000000000000000000000000000002", creditor: "0x0000000000000000000000000000000000000003" }],
    });
    await expect(recordSettlement(HASH)).resolves.toEqual({ ok: false, error: "No settlement found for that transaction." });
    expect(upsertSettlement).not.toHaveBeenCalled();
  });
});
