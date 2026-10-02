import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

const mocks = vi.hoisted(() => ({
  signAttestation: vi.fn(),
  registerInvoice: vi.fn(),
  settleBestCycle: vi.fn(),
  estimateUsdcToEurcSwap: vi.fn(),
  fundResidualViaGateway: vi.fn(),
  computeDashboardTiles: vi.fn(),
}));

vi.mock("../src/attest/signAttestation", () => ({ signAttestation: mocks.signAttestation }));
vi.mock("../src/actions/register", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/actions/register")>();
  return { ...actual, registerInvoice: mocks.registerInvoice };
});
vi.mock("../src/actions/settle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/actions/settle")>();
  return { ...actual, settleBestCycle: mocks.settleBestCycle };
});
vi.mock("../src/kits/swap", () => ({ estimateUsdcToEurcSwap: mocks.estimateUsdcToEurcSwap }));
vi.mock("../src/kits/unifiedBalance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/kits/unifiedBalance")>();
  return { ...actual, fundResidualViaGateway: mocks.fundResidualViaGateway };
});
vi.mock("../src/receipt/dashboardTiles", () => ({ computeDashboardTiles: mocks.computeDashboardTiles }));

import { runSettlementPipeline } from "../src/actions/pipeline";
import { RegisterTransactionOutcomeError } from "../src/actions/register";
import { SettleTransactionOutcomeError } from "../src/actions/settle";

const hash = (digit: string) => `0x${digit.repeat(64)}` as Hex;
const invoice = {
  invoiceRef: hash("a"), amount: 1_000_000n, currency: hash("b"), maturity: 2n,
  earlyNetConsent: true, debtor: hash("1"), creditor: hash("2"), nonce: 1n,
  registry: hash("3"), chainId: 5042002n,
} as const;

function params() {
  return {
    publicClient: {} as never,
    registerSigner: {} as never,
    settleSigner: {} as never,
    registry: hash("3"),
    settler: hash("4"),
    arcChainId: 5042002,
    invoicesToRegister: [{ invoice, debtorPrivateKey: hash("5"), creditorPrivateKey: hash("6") }],
  };
}

describe("settlement pipeline transaction outcomes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.signAttestation.mockResolvedValue({ debtorSignature: hash("7"), creditorSignature: hash("8") });
    mocks.computeDashboardTiles.mockReturnValue({});
  });

  it("keeps an unknown registration hash and does not report registration as failed", async () => {
    const txHash = hash("9");
    mocks.registerInvoice.mockRejectedValue(new RegisterTransactionOutcomeError(txHash, "unknown"));

    const result = await runSettlementPipeline(params());

    expect(result.registrationError).toMatchObject({ outcome: "unknown", txHash });
    expect(result.registered).toEqual([]);
    expect(result.settleStatus).toBe("not_attempted");
    expect(mocks.settleBestCycle).not.toHaveBeenCalled();
  });

  it("marks a reverted settle failed while retaining registrations", async () => {
    const txHash = hash("9");
    mocks.registerInvoice.mockResolvedValue({ invoiceId: hash("a"), txHash: hash("b"), blockNumber: 1n });
    mocks.settleBestCycle.mockRejectedValue(new SettleTransactionOutcomeError(txHash, "reverted"));

    const result = await runSettlementPipeline(params());

    expect(result.registered).toHaveLength(1);
    expect(result.settleStatus).toBe("failed");
    expect(result.settleError?.txHash).toBe(txHash);
    expect(result.danglingInvoiceIds).toEqual([hash("a")]);
  });

  it("keeps confirmed settlement when a later quote fails", async () => {
    const txHash = hash("9");
    mocks.registerInvoice.mockResolvedValue({ invoiceId: hash("a"), txHash: hash("b"), blockNumber: 1n });
    mocks.settleBestCycle.mockRejectedValue(new Error("No cycle"));
    // A separate registered dangling invoice is needed to exercise residual quote follow-up.
    const second = { ...invoice, invoiceRef: hash("c"), debtor: hash("d"), creditor: hash("e") };
    const input = params();
    input.invoicesToRegister.push({ invoice: second, debtorPrivateKey: hash("5"), creditorPrivateKey: hash("6") });
    mocks.registerInvoice
      .mockResolvedValueOnce({ invoiceId: hash("a"), txHash: hash("b"), blockNumber: 1n })
      .mockResolvedValueOnce({ invoiceId: hash("c"), txHash: hash("f"), blockNumber: 2n });
    const settle = { invoiceIds: [hash("a")], wNet: 1n, txHash, blockNumber: 3n, gasPaidWei: 4n };
    mocks.settleBestCycle.mockResolvedValue(settle);
    mocks.estimateUsdcToEurcSwap.mockRejectedValue(new Error("quote unavailable"));

    const result = await runSettlementPipeline({ ...input, residual: { swapKit: {} as never } });

    expect(result.settle).toBe(settle);
    expect(result.settleStatus).toBe("settled");
    expect(result.residualQuoteError).toBe("quote unavailable");
    expect(result.danglingInvoiceIds).toEqual([hash("c")]);
  });
});
