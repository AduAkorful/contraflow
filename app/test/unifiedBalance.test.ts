import { UnifiedBalanceChain } from "@circle-fin/app-kit";
import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";

import { createOperatorAdapter } from "../src/kits/appkit";
import {
  depositToGateway,
  estimateDepositToGateway,
  estimateSpendOntoArc,
  fundResidualViaGateway,
  GatewayFundResidualPartialFailureError,
  getUsdcBalances,
  resumeFundResidualViaGateway,
  spendOntoArc,
  unifiedBalanceChainForChainId,
} from "../src/kits/unifiedBalance";
import { ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import type { ContraflowAppKitAdapter } from "../src/kits/appkit";

function stubAppKit(): {
  appKit: ContraflowAppKitAdapter;
  getBalances: ReturnType<typeof vi.fn>;
  estimateDeposit: ReturnType<typeof vi.fn>;
  deposit: ReturnType<typeof vi.fn>;
  estimateSpend: ReturnType<typeof vi.fn>;
  spend: ReturnType<typeof vi.fn>;
} {
  const getBalances = vi.fn().mockResolvedValue({ total: "0", byChain: [] });
  const estimateDeposit = vi.fn().mockResolvedValue({ fees: [] });
  const deposit = vi.fn().mockResolvedValue({ txHash: "0xdep" });
  const estimateSpend = vi.fn().mockResolvedValue({ fees: [] });
  const spend = vi.fn().mockResolvedValue({ txHash: "0xspend" });
  const appKit = {
    kit: { unifiedBalance: { getBalances, estimateDeposit, deposit, estimateSpend, spend } } as unknown as ContraflowAppKitAdapter["kit"],
    adapter: {} as ContraflowAppKitAdapter["adapter"],
  };
  return { appKit, getBalances, estimateDeposit, deposit, estimateSpend, spend };
}

describe("unified balance chain resolution", () => {
  it("resolves Arc testnet's chain id to UnifiedBalanceChain.Arc_Testnet", () => {
    expect(unifiedBalanceChainForChainId(ARC_TESTNET_CHAIN_ID)).toBe("Arc_Testnet");
  });

  it("throws UnsupportedUnifiedBalanceChainError for an unknown chain id", () => {
    expect(() => unifiedBalanceChainForChainId(999999)).toThrowError(/no UnifiedBalanceChain enum mapping/);
  });
});

describe("unified balance parameter building", () => {
  it("getUsdcBalances passes networkType: testnet for Arc testnet, not the mainnet default", async () => {
    const { appKit, getBalances } = stubAppKit();

    await getUsdcBalances({ appKit, arcChainId: ARC_TESTNET_CHAIN_ID });

    expect(getBalances).toHaveBeenCalledWith({
      token: "USDC",
      sources: { adapter: appKit.adapter },
      networkType: "testnet",
    });
  });

  it("estimateDepositToGateway/depositToGateway use the given source chain, not Arc", async () => {
    const { appKit, estimateDeposit, deposit } = stubAppKit();
    const params = { appKit, sourceChain: UnifiedBalanceChain.Ethereum_Sepolia, amountUsdc: "100" };

    await estimateDepositToGateway(params);
    await depositToGateway(params);

    const expected = { from: { adapter: appKit.adapter, chain: UnifiedBalanceChain.Ethereum_Sepolia }, amount: "100", token: "USDC" };
    expect(estimateDeposit).toHaveBeenCalledWith(expected);
    expect(deposit).toHaveBeenCalledWith(expected);
  });

  it("estimateSpendOntoArc/spendOntoArc mint onto the resolved Arc chain, pulling an explicit allocation from the given source chain", async () => {
    const { appKit, estimateSpend, spend } = stubAppKit();
    const params = {
      appKit,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      sourceChain: UnifiedBalanceChain.Ethereum_Sepolia,
      amountUsdc: "50",
    };

    await estimateSpendOntoArc(params);
    await spendOntoArc(params);

    const expected = {
      from: { adapter: appKit.adapter, allocations: [{ amount: "50", chain: UnifiedBalanceChain.Ethereum_Sepolia }] },
      to: { adapter: appKit.adapter, chain: "Arc_Testnet" },
      token: "USDC",
      amount: "50",
    };
    expect(estimateSpend).toHaveBeenCalledWith(expected);
    expect(spend).toHaveBeenCalledWith(expected);
  });
});

function balanceResult(ethereumSepoliaConfirmed: string) {
  return {
    token: "USDC",
    totalConfirmedBalance: ethereumSepoliaConfirmed,
    breakdown: [
      {
        depositor: "0xoperator",
        totalConfirmed: ethereumSepoliaConfirmed,
        breakdown: [{ chain: "Ethereum_Sepolia", confirmedBalance: ethereumSepoliaConfirmed }],
      },
    ],
  };
}

describe("fundResidualViaGateway", () => {
  it("deposits, polls until the confirmed balance increases by the deposit amount, then spends", async () => {
    const { appKit, deposit, getBalances, spend } = stubAppKit();
    getBalances
      .mockResolvedValueOnce(balanceResult("0.000000")) // pre-deposit read
      .mockResolvedValueOnce(balanceResult("0.000000")) // poll 1: not yet confirmed
      .mockResolvedValueOnce(balanceResult("1.700000")); // poll 2: confirmed (0.50 + 1.20 margin)

    const result = await fundResidualViaGateway({
      appKit,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      sourceChain: UnifiedBalanceChain.Ethereum_Sepolia,
      amountUsdc: "0.50",
      pollIntervalMs: 1,
    });

    expect(deposit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "1.700000" }), // default margin: 0.50 + 1.20
    );
    expect(spend).toHaveBeenCalledWith(expect.objectContaining({ amount: "0.50" }));
    expect(result).toEqual({ txHash: "0xspend" });
  });

  it("accounts for a pre-existing confirmed balance rather than an absolute threshold", async () => {
    const { appKit, getBalances, spend } = stubAppKit();
    // Already 1.00 confirmed from earlier activity -- must wait for +depositAmount on top of
    // that, not for an absolute value that a stale prior balance could already satisfy.
    getBalances
      .mockResolvedValueOnce(balanceResult("1.000000")) // pre-deposit read
      .mockResolvedValueOnce(balanceResult("1.000000")) // poll 1: unchanged, must not spend yet
      .mockResolvedValueOnce(balanceResult("2.700000")); // poll 2: increased by the deposit amount

    await fundResidualViaGateway({
      appKit,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      sourceChain: UnifiedBalanceChain.Ethereum_Sepolia,
      amountUsdc: "0.50",
      pollIntervalMs: 1,
    });

    expect(spend).toHaveBeenCalledTimes(1);
  });

  it("wraps a poll timeout in GatewayFundResidualPartialFailureError, not a bare GatewayDepositTimeoutError", async () => {
    // The deposit has already landed by the time a timeout (or any other post-deposit failure)
    // happens -- calling fundResidualViaGateway again would deposit a second time, so the caller
    // needs a clear, resumable error rather than the underlying timeout alone (plans/13-orchestration-pipeline.md).
    const { appKit, deposit, getBalances } = stubAppKit();
    getBalances.mockResolvedValue(balanceResult("0.000000"));

    const call = fundResidualViaGateway({
      appKit,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      sourceChain: UnifiedBalanceChain.Ethereum_Sepolia,
      amountUsdc: "0.50",
      pollIntervalMs: 1,
      maxPolls: 3,
    });

    await expect(call).rejects.toThrow(GatewayFundResidualPartialFailureError);
    expect(deposit).toHaveBeenCalledTimes(1); // deposit happened exactly once, not retried internally

    try {
      await call;
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayFundResidualPartialFailureError);
      const failure = err as GatewayFundResidualPartialFailureError;
      expect(failure.sourceChain).toBe(UnifiedBalanceChain.Ethereum_Sepolia);
      expect(failure.arcChainId).toBe(ARC_TESTNET_CHAIN_ID);
      expect(failure.amountUsdc).toBe("0.50");
      expect(failure.depositAmountUsdc).toBe("1.700000");
      expect(failure.target).toBeCloseTo(1.7);
    }
  });
});

describe("resumeFundResidualViaGateway", () => {
  it("never deposits again -- only polls and spends", async () => {
    const { appKit, deposit, getBalances, spend } = stubAppKit();
    getBalances
      .mockResolvedValueOnce(balanceResult("1.000000")) // poll 1: not yet confirmed
      .mockResolvedValueOnce(balanceResult("1.700000")); // poll 2: confirmed

    const result = await resumeFundResidualViaGateway({
      appKit,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      sourceChain: UnifiedBalanceChain.Ethereum_Sepolia,
      amountUsdc: "0.50",
      depositAmountUsdc: "1.700000",
      target: 1.7,
      pollIntervalMs: 1,
    });

    expect(deposit).not.toHaveBeenCalled();
    expect(spend).toHaveBeenCalledWith(expect.objectContaining({ amount: "0.50" }));
    expect(result).toEqual({ txHash: "0xspend" });
  });

  it("wraps a repeated failure the same way as fundResidualViaGateway", async () => {
    const { appKit, getBalances } = stubAppKit();
    getBalances.mockResolvedValue(balanceResult("0.000000"));

    await expect(
      resumeFundResidualViaGateway({
        appKit,
        arcChainId: ARC_TESTNET_CHAIN_ID,
        sourceChain: UnifiedBalanceChain.Ethereum_Sepolia,
        amountUsdc: "0.50",
        depositAmountUsdc: "1.700000",
        target: 1.7,
        pollIntervalMs: 1,
        maxPolls: 3,
      }),
    ).rejects.toThrow(GatewayFundResidualPartialFailureError);
  });
});

describe("getUsdcBalances against the real Circle Unified Balance service", () => {
  it(
    "returns a real (possibly zero) balance result for the operator's testnet address, no funds moved",
    async () => {
      const appKit = createOperatorAdapter(generatePrivateKey());

      const result = await getUsdcBalances({ appKit, arcChainId: ARC_TESTNET_CHAIN_ID });

      expect(result).toBeTruthy();
    },
    30_000,
  );
});
