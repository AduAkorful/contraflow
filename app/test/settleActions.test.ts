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

const { findSettleableLoop, recordSettlement } = await import("../app/app/settle/actions");

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
