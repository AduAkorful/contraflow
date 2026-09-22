import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchContractLogs = vi.fn();
const fetchTransactionFee = vi.fn();
vi.mock("../src/blockscout/client", async () => {
  const actual = await vi.importActual<typeof import("../src/blockscout/client")>("../src/blockscout/client");
  return { ...actual, fetchContractLogs, fetchTransactionFee };
});

const getInvoicesForAddress = vi.fn();
const upsertRegisteredInvoice = vi.fn();
const upsertSettledInvoice = vi.fn();
const upsertSettlement = vi.fn();
vi.mock("../src/db/invoices", () => ({
  getInvoicesForAddress,
  upsertRegisteredInvoice,
  upsertSettledInvoice,
  upsertSettlement,
}));

const { reconcileAddress, parseRegistered, parseNetted } = await import("../src/blockscout/reconcile");

const DEBTOR = "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C";
const CREDITOR = "0xD98CC80747e67B357EA914614C213209c877Be04";
const OTHER = "0x0000000000000000000000000000000000dEaD";

function registeredLog(id: string, debtor: string, creditor: string, txHash: string) {
  return {
    transactionHash: txHash,
    blockNumber: 1,
    methodCall: "InvoiceRegistered(bytes32 indexed id, address indexed debtor, address indexed creditor, uint256 amount, uint64 maturity, bool earlyNetConsent, uint256 nonce)",
    parameters: [
      { name: "id", type: "bytes32", value: id },
      { name: "debtor", type: "address", value: debtor },
      { name: "creditor", type: "address", value: creditor },
      { name: "amount", type: "uint256", value: "1000000000" },
      { name: "maturity", type: "uint64", value: "1792588650" },
      { name: "earlyNetConsent", type: "bool", value: "true" },
      { name: "nonce", type: "uint256", value: "1" },
    ],
  };
}

function nettedLog(id: string, wNet: string, remainingAfter: string, txHash: string) {
  return {
    transactionHash: txHash,
    blockNumber: 2,
    methodCall: "InvoiceNetted(bytes32 indexed id, uint256 wNet, uint256 remainingAfter, uint8 status)",
    parameters: [
      { name: "id", type: "bytes32", value: id },
      { name: "wNet", type: "uint256", value: wNet },
      { name: "remainingAfter", type: "uint256", value: remainingAfter },
      { name: "status", type: "uint8", value: "0" },
    ],
  };
}

describe("parseRegistered / parseNetted", () => {
  it("parses a well-formed InvoiceRegistered log", () => {
    const parsed = parseRegistered(registeredLog("0xid1", DEBTOR, CREDITOR, "0xtx1"));
    expect(parsed).toEqual({
      invoiceRef: "0xid1",
      debtor: DEBTOR,
      creditor: CREDITOR,
      amountBaseUnits: 1_000_000_000n,
      maturity: "1792588650",
      earlyNetConsent: true,
      nonce: 1n,
      registerTxHash: "0xtx1",
    });
  });

  it("returns null for a log that isn't InvoiceRegistered", () => {
    expect(parseRegistered(nettedLog("0xid1", "1", "0", "0xtx1"))).toBeNull();
  });

  it("parses a well-formed InvoiceNetted log", () => {
    const parsed = parseNetted(nettedLog("0xid1", "500000000", "300000000", "0xtx2"));
    expect(parsed).toEqual({
      invoiceRef: "0xid1",
      wNetBaseUnits: 500_000_000n,
      remainingAfterBaseUnits: 300_000_000n,
      transactionHash: "0xtx2",
    });
  });
});

describe("reconcileAddress", () => {
  beforeEach(() => {
    fetchContractLogs.mockReset();
    fetchTransactionFee.mockReset();
    getInvoicesForAddress.mockReset();
    upsertRegisteredInvoice.mockReset();
    upsertSettledInvoice.mockReset();
    upsertSettlement.mockReset();
    getInvoicesForAddress.mockResolvedValue([]);
  });

  it("upserts a registered invoice only when the target address is debtor or creditor", async () => {
    fetchContractLogs.mockResolvedValueOnce([
      registeredLog("0xmine", DEBTOR, CREDITOR, "0xreg1"),
      registeredLog("0xnotmine", OTHER, CREDITOR, "0xreg2"),
    ]);

    await reconcileAddress(DEBTOR);

    expect(upsertRegisteredInvoice).toHaveBeenCalledTimes(1);
    expect(upsertRegisteredInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceRef: "0xmine", debtor: DEBTOR, creditor: CREDITOR }),
    );
  });

  it("matches debtor/creditor case-insensitively", async () => {
    fetchContractLogs.mockResolvedValueOnce([registeredLog("0xmine", DEBTOR, CREDITOR, "0xreg1")]);

    await reconcileAddress(DEBTOR.toLowerCase());

    expect(upsertRegisteredInvoice).toHaveBeenCalledTimes(1);
  });

  it("marks an invoice settled and attributes the settle tx's true cycle length, not just this address's share", async () => {
    // Full cycle netted 3 invoices in one tx, but only one belongs to the target address.
    fetchContractLogs.mockResolvedValueOnce([
      registeredLog("0xmine", DEBTOR, CREDITOR, "0xreg1"),
      nettedLog("0xmine", "500000000", "0", "0xsettle1"),
      nettedLog("0xother1", "500000000", "100000000", "0xsettle1"),
      nettedLog("0xother2", "500000000", "200000000", "0xsettle1"),
    ]);
    fetchTransactionFee.mockResolvedValueOnce({ blockNumber: 99, gasPaidWei: "12345" });

    await reconcileAddress(DEBTOR);

    expect(upsertSettledInvoice).toHaveBeenCalledTimes(1);
    expect(upsertSettledInvoice).toHaveBeenCalledWith({
      invoiceRef: "0xmine",
      settleTxHash: "0xsettle1",
      wNetUsdc: "500.00",
      remainingUsdc: "0.00",
    });
    expect(upsertSettlement).toHaveBeenCalledWith({
      settleTxHash: "0xsettle1",
      blockNumber: "99",
      wNetUsdc: "500.00",
      cycleLength: 3,
      gasPaidWei: "12345",
    });
  });

  it("never throws on a Blockscout failure — returns the existing DB rows with reconciled: false", async () => {
    getInvoicesForAddress.mockResolvedValue([{ invoiceRef: "0xexisting" }]);
    fetchContractLogs.mockRejectedValueOnce(new Error("network down"));

    const result = await reconcileAddress(DEBTOR);

    expect(result.reconciled).toBe(false);
    expect(result.error).toBe("network down");
    expect(result.invoices).toEqual([{ invoiceRef: "0xexisting" }]);
  });
});
