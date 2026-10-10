import { beforeEach, describe, expect, it, vi } from "vitest";

const registerInvoice = vi.fn();
const proposeSettlement = vi.fn();
const settleBestCycle = vi.fn();
const computeDashboardTiles = vi.fn();
const getInvoice = vi.fn();
const signAttestation = vi.fn();
const invoiceAttestationId = vi.fn((attestation: { testId: string }) => attestation.testId);
const buildDemoCycleInvoices = vi.fn();
const deriveDemoParties = vi.fn();
const publicClient = vi.fn(() => ({}));
const operatorSigner = vi.fn(() => ({ kind: "raw-key", walletClient: {} }));
const upsertRegisteredInvoice = vi.fn();
const upsertSettledInvoice = vi.fn();
const upsertSettlement = vi.fn();
const requestIp = vi.fn();
const claimDemoSpend = vi.fn();
const completeDemoSpend = vi.fn();
const inspectDemoSpend = vi.fn();

const rememberDemoRunInvoiceId = vi.fn();
const loadDemoRunInvoiceIds = vi.fn();
const demoRunIdsMatch = vi.fn();

vi.mock("../src/contracts/addresses", () => ({
  ARC_TESTNET_CHAIN_ID: 5042002,
  addressesForChain: () => ({
    registry: "0x0000000000000000000000000000000000000001",
    settler: "0x0000000000000000000000000000000000000002",
    usdc: "0x0000000000000000000000000000000000000003",
  }),
}));
vi.mock("../src/actions/register", () => ({
  registerInvoice,
  ComplianceRejectedError: class ComplianceRejectedError extends Error {},
}));
vi.mock("../src/actions/settle", () => ({
  proposeSettlement,
  settleBestCycle,
  NoSettleableCycleError: class NoSettleableCycleError extends Error {},
}));
vi.mock("../src/receipt/dashboardTiles", () => ({ computeDashboardTiles }));
vi.mock("../src/chain/readInvoices", () => ({ getInvoice }));
vi.mock("../src/attest/signAttestation", () => ({ signAttestation, invoiceAttestationId }));
vi.mock("../src/fixtures/demoCycle", () => ({ buildDemoCycleInvoices }));
vi.mock("../src/demo/runIds", () => ({
  rememberDemoRunInvoiceId,
  loadDemoRunInvoiceIds,
  demoRunIdsMatch,
  DEMO_RUN_EXPIRED_MESSAGE: "This demo run has expired. Start a new one.",
  DEMO_RUN_UNAVAILABLE_MESSAGE: "Demo run records are unavailable. Try again later.",
}));
vi.mock("../src/fixtures/demoIdentities", () => ({
  deriveDemoParties,
  MIN_DEMO_PARTIES: 3,
  MAX_DEMO_PARTIES: 5,
}));
vi.mock("../src/chain/operatorEnv", () => ({ arcPublicClient: publicClient, operatorSigner }));
vi.mock("../src/db/invoices", () => ({ upsertRegisteredInvoice, upsertSettledInvoice, upsertSettlement }));
vi.mock("../src/ratelimit/requestIp", () => ({ requestIp }));
vi.mock("../src/demo/spendBudget", async () => {
  const actual = await vi.importActual<typeof import("../src/demo/spendBudget")>("../src/demo/spendBudget");
  return {
    ...actual,
    claimDemoSpend,
    completeDemoSpend,
    inspectDemoSpend,
  };
});

const { registerCycleInvoiceStep, settleProposedCycle } = await import("../src/app/app/demo/actions");

const HASH = `0x${"1".repeat(64)}` as const;

describe("public demo spend controls", () => {
  beforeEach(() => {
    for (const fn of [
      registerInvoice,
      proposeSettlement,
      settleBestCycle,
      computeDashboardTiles,
      getInvoice,
      signAttestation,
      invoiceAttestationId,
      buildDemoCycleInvoices,
      deriveDemoParties,
      publicClient,
      operatorSigner,
      upsertRegisteredInvoice,
      upsertSettledInvoice,
      upsertSettlement,
      requestIp,
      claimDemoSpend,
      completeDemoSpend,
      inspectDemoSpend,
      rememberDemoRunInvoiceId,
      loadDemoRunInvoiceIds,
      demoRunIdsMatch,
    ]) fn.mockReset();

    requestIp.mockResolvedValue("203.0.113.8");
    inspectDemoSpend.mockResolvedValue({ kind: "reserved", operationKey: "unused" });
    claimDemoSpend.mockResolvedValue({ kind: "reserved", operationKey: "operation-key" });
    completeDemoSpend.mockResolvedValue(undefined);
    publicClient.mockReturnValue({});
    operatorSigner.mockReturnValue({ kind: "raw-key", walletClient: {} });
    invoiceAttestationId.mockImplementation((attestation) => attestation.testId);
    deriveDemoParties.mockReturnValue([]);
    buildDemoCycleInvoices.mockReturnValue([{
      label: "Party A → Party B",
      amountUsdc: "500.00",
      attestation: {
        debtor: "0x0000000000000000000000000000000000000004",
        testId: HASH,
        maturity: 1n,
        earlyNetConsent: true,
      },
      debtor: { privateKey: "0x01" },
      creditor: { privateKey: "0x02" },
    }]);
    signAttestation.mockResolvedValue({ debtorSignature: "0x11", creditorSignature: "0x22" });
    registerInvoice.mockResolvedValue({ invoiceId: HASH, txHash: HASH });
    rememberDemoRunInvoiceId.mockResolvedValue(undefined);
    loadDemoRunInvoiceIds.mockResolvedValue({ kind: "missing" });
    demoRunIdsMatch.mockReturnValue(false);
    for (const fn of [upsertRegisteredInvoice, upsertSettledInvoice, upsertSettlement]) fn.mockResolvedValue(undefined);
  });

  it("reserves a bounded, deduplicated slot before registering and caches confirmed success", async () => {
    const result = await registerCycleInvoiceStep("run-1", 3, 0);

    expect(result).toMatchObject({ ok: true });
    expect(claimDemoSpend).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "register:3:0:run-1",
      callerIp: "203.0.113.8",
      limits: expect.objectContaining({ gas: 250_000n }),
    }));
    expect(registerInvoice).toHaveBeenCalledWith(expect.objectContaining({
      transactionLimits: expect.objectContaining({ gas: 250_000n }),
    }));
    expect(completeDemoSpend).toHaveBeenCalledWith("operation-key", result);
    expect(rememberDemoRunInvoiceId).toHaveBeenCalledWith("run-1", HASH);
  });

  it("replays a prior result without spending again", async () => {
    const prior = { ok: true, invoice: { label: "A", amountUsdc: "1", invoiceId: HASH, txHash: HASH, explorerUrl: "url" } };
    inspectDemoSpend.mockResolvedValueOnce({ kind: "complete", result: prior });

    await expect(registerCycleInvoiceStep("run-1", 3, 0)).resolves.toEqual(prior);
    expect(claimDemoSpend).not.toHaveBeenCalled();
    expect(registerInvoice).not.toHaveBeenCalled();
    expect(rememberDemoRunInvoiceId).toHaveBeenCalledWith("run-1", HASH);
  });

  it("records the run's invoice ID when the reservation finds the step already finished", async () => {
    const prior = { ok: true, invoice: { label: "A", amountUsdc: "1", invoiceId: HASH, txHash: HASH, explorerUrl: "url" } };
    claimDemoSpend.mockResolvedValueOnce({ kind: "complete", result: prior });

    await expect(registerCycleInvoiceStep("run-1", 3, 0)).resolves.toEqual(prior);
    expect(registerInvoice).not.toHaveBeenCalled();
    expect(rememberDemoRunInvoiceId).toHaveBeenCalledWith("run-1", HASH);
  });

  it("does not broadcast when the budget reservation fails", async () => {
    claimDemoSpend.mockResolvedValueOnce({ kind: "budget_exceeded" });
    const result = await registerCycleInvoiceStep("run-1", 3, 0);

    expect(result).toMatchObject({ ok: false });
    expect(registerInvoice).not.toHaveBeenCalled();
  });

  it("does not reserve settlement spend for a cycle that is not settleable", async () => {
    const invoiceIds = [HASH, `0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`];
    loadDemoRunInvoiceIds.mockResolvedValueOnce({ kind: "ids", ids: invoiceIds });
    demoRunIdsMatch.mockReturnValueOnce(true);
    proposeSettlement.mockResolvedValueOnce(null);
    const result = await settleProposedCycle("run-settle", invoiceIds, {});

    expect(result).toMatchObject({ ok: false });
    expect(claimDemoSpend).not.toHaveBeenCalled();
    expect(settleBestCycle).not.toHaveBeenCalled();
  });

  it("applies the same gas ceiling to settlement and replays its confirmed result", async () => {
    const invoiceIds = [HASH, `0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`];
    loadDemoRunInvoiceIds.mockResolvedValueOnce({ kind: "ids", ids: invoiceIds });
    demoRunIdsMatch.mockReturnValueOnce(true);
    proposeSettlement.mockResolvedValueOnce({ invoiceIds, wNet: 1_000_000n });
    settleBestCycle.mockResolvedValueOnce({
      invoiceIds,
      wNet: 1_000_000n,
      txHash: HASH,
      blockNumber: 123n,
      gasPaidWei: 456n,
    });
    computeDashboardTiles.mockReturnValue({
      gasPaidWei: 456n,
      grossCancelledUsdc: 3_000_000n,
      cashMovedUsdc: 0n,
      multiplier: null,
    });
    getInvoice.mockResolvedValue({ amountRemaining: 2_000_000n });

    const result = await settleProposedCycle("run-settle", invoiceIds, {});

    expect(result.ok).toBe(true);
    expect(settleBestCycle).toHaveBeenCalledWith(expect.objectContaining({
      transactionLimits: expect.objectContaining({ gas: 500_000n }),
    }));
    expect(completeDemoSpend).toHaveBeenCalledWith("operation-key", result);
  });

  it("rejects settlement ids that are not the recorded demo run", async () => {
    const invoiceIds = [HASH, `0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`];
    loadDemoRunInvoiceIds.mockResolvedValueOnce({ kind: "ids", ids: [HASH] });
    demoRunIdsMatch.mockReturnValueOnce(false);
    const result = await settleProposedCycle("run-settle", invoiceIds, {});

    expect(result).toMatchObject({ ok: false, error: "These invoices do not belong to this demo run" });
    expect(claimDemoSpend).not.toHaveBeenCalled();
    expect(proposeSettlement).not.toHaveBeenCalled();
  });

  it("settles a recorded run even after time has moved on", async () => {
    const invoiceIds = [HASH, `0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`];
    loadDemoRunInvoiceIds.mockResolvedValueOnce({ kind: "ids", ids: invoiceIds });
    demoRunIdsMatch.mockReturnValueOnce(true);
    proposeSettlement.mockResolvedValueOnce({ invoiceIds, wNet: 1_000_000n });
    settleBestCycle.mockResolvedValueOnce({
      invoiceIds,
      wNet: 1_000_000n,
      txHash: HASH,
      blockNumber: 123n,
      gasPaidWei: 456n,
    });
    computeDashboardTiles.mockReturnValue({
      gasPaidWei: 456n,
      grossCancelledUsdc: 3_000_000n,
      cashMovedUsdc: 0n,
      multiplier: null,
    });
    getInvoice.mockResolvedValue({ amountRemaining: 2_000_000n });

    const result = await settleProposedCycle("run-later", invoiceIds, {});
    expect(result.ok).toBe(true);
    expect(buildDemoCycleInvoices).not.toHaveBeenCalled();
  });

  it("fails closed when the run record is missing", async () => {
    const invoiceIds = [HASH, `0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`];
    loadDemoRunInvoiceIds.mockResolvedValueOnce({ kind: "missing" });
    const result = await settleProposedCycle("run-expired", invoiceIds, {});

    expect(result).toMatchObject({ ok: false, error: "This demo run has expired. Start a new one." });
    expect(claimDemoSpend).not.toHaveBeenCalled();
    expect(settleBestCycle).not.toHaveBeenCalled();
  });
});
