import { describe, expect, it, vi, beforeEach } from "vitest";
import { encodeEventTopics, encodeAbiParameters, type Hex } from "viem";
import { contraflowRegistryAbi } from "../src/contracts/abi/index";
import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";

const getTransactionReceipt = vi.fn();
const arcPublicClient = vi.fn(() => ({ getTransactionReceipt }));
vi.mock("../src/chain/operatorEnv", () => ({ arcPublicClient }));

const upsertRegisteredInvoice = vi.fn();
vi.mock("../src/db/invoices", () => ({ upsertRegisteredInvoice }));

const { recordRegistration } = await import("../src/attest/record");

const { registry } = addressesForChain(ARC_TESTNET_CHAIN_ID);
const DEBTOR = "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C";
const CREDITOR = "0xD98CC80747e67B357EA914614C213209c877Be04";
const INVOICE_ID = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;

function realInvoiceRegisteredLog(overrides: { address?: string } = {}) {
  const topics = encodeEventTopics({
    abi: contraflowRegistryAbi,
    eventName: "InvoiceRegistered",
    args: { id: INVOICE_ID, debtor: DEBTOR, creditor: CREDITOR },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "uint256" }],
    [1_050_000_000n, 1_792_588_650n, true, 1n],
  );
  return { address: overrides.address ?? registry, topics, data };
}

describe("recordRegistration", () => {
  beforeEach(() => {
    getTransactionReceipt.mockReset();
    upsertRegisteredInvoice.mockReset();
  });

  it("decodes a genuine InvoiceRegistered log and writes through", async () => {
    getTransactionReceipt.mockResolvedValueOnce({
      status: "success",
      to: registry,
      logs: [realInvoiceRegisteredLog()],
    });

    const result = await recordRegistration("0xtx" as Hex);

    expect(result).toEqual({ ok: true, invoiceRef: INVOICE_ID });
    expect(upsertRegisteredInvoice).toHaveBeenCalledWith({
      invoiceRef: INVOICE_ID,
      debtor: DEBTOR,
      creditor: CREDITOR,
      amountUsdc: "1050.00",
      maturity: "1792588650",
      earlyNetConsent: true,
      registerTxHash: "0xtx",
    });
  });

  it("rejects a tx hash that doesn't exist", async () => {
    getTransactionReceipt.mockRejectedValueOnce(new Error("not found"));
    const result = await recordRegistration("0xfake" as Hex);
    expect(result).toEqual({ ok: false, reason: "Transaction not found." });
    expect(upsertRegisteredInvoice).not.toHaveBeenCalled();
  });

  it("rejects a failed transaction", async () => {
    getTransactionReceipt.mockResolvedValueOnce({ status: "reverted", to: registry, logs: [] });
    const result = await recordRegistration("0xtx" as Hex);
    expect(result.ok).toBe(false);
    expect(upsertRegisteredInvoice).not.toHaveBeenCalled();
  });

  it("rejects a transaction that wasn't a call to the Registry contract — never trusts the claim", async () => {
    getTransactionReceipt.mockResolvedValueOnce({
      status: "success",
      to: "0x000000000000000000000000000000000000dEaD",
      logs: [realInvoiceRegisteredLog()],
    });
    const result = await recordRegistration("0xtx" as Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Registry contract/);
    expect(upsertRegisteredInvoice).not.toHaveBeenCalled();
  });

  it("rejects a real, successful tx to the registry that just never emitted InvoiceRegistered", async () => {
    getTransactionReceipt.mockResolvedValueOnce({ status: "success", to: registry, logs: [] });
    const result = await recordRegistration("0xtx" as Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/did not emit/);
  });

  it("ignores a log from a different contract address, even if it happens to decode", async () => {
    getTransactionReceipt.mockResolvedValueOnce({
      status: "success",
      to: registry,
      logs: [realInvoiceRegisteredLog({ address: "0x000000000000000000000000000000000000dEaD" })],
    });
    const result = await recordRegistration("0xtx" as Hex);
    expect(result.ok).toBe(false);
  });
});
