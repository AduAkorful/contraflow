import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";

import { createContraflowSwapKit } from "../src/kits/appkit";
import { estimateUsdcToEurcSwap, swapUsdcToEurc } from "../src/kits/swap";
import { ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import type { ContraflowSwapKit } from "../src/kits/appkit";

function stubSwapKit(): { swapKit: ContraflowSwapKit; estimateSwap: ReturnType<typeof vi.fn>; swap: ReturnType<typeof vi.fn> } {
  const estimateSwap = vi.fn().mockResolvedValue({ estimatedOutput: { amount: "0.92", token: "EURC" } });
  const swap = vi.fn().mockResolvedValue({ txHash: "0xabc" });
  const swapKit = {
    kit: { estimateSwap, swap } as unknown as ContraflowSwapKit["kit"],
    adapter: {} as ContraflowSwapKit["adapter"],
    chain: "Arc_Testnet" as ContraflowSwapKit["chain"],
  };
  return { swapKit, estimateSwap, swap };
}

describe("swap kit parameter building", () => {
  it("estimateUsdcToEurcSwap passes USDC->EURC with the swap kit's adapter/chain", async () => {
    const { swapKit, estimateSwap } = stubSwapKit();

    await estimateUsdcToEurcSwap({ swapKit, amountInUsdc: "1.00" });

    expect(estimateSwap).toHaveBeenCalledWith({
      from: { adapter: swapKit.adapter, chain: swapKit.chain },
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "1.00",
      config: { slippageBps: undefined, apiKey: undefined },
    });
  });

  it("swapUsdcToEurc forwards slippageBps and apiKey when provided", async () => {
    const { swapKit, swap } = stubSwapKit();

    await swapUsdcToEurc({ swapKit, amountInUsdc: "5.50", slippageBps: 300, apiKey: "TEST_API_KEY:id:secret" });

    expect(swap).toHaveBeenCalledWith({
      from: { adapter: swapKit.adapter, chain: swapKit.chain },
      tokenIn: "USDC",
      tokenOut: "EURC",
      amountIn: "5.50",
      config: { slippageBps: 300, apiKey: "TEST_API_KEY:id:secret" },
    });
  });
});

describe("createContraflowSwapKit chain resolution", () => {
  it("resolves Arc testnet's chain id to SwapChain.Arc_Testnet", () => {
    const { chain } = createContraflowSwapKit(generatePrivateKey(), ARC_TESTNET_CHAIN_ID);
    expect(chain).toBe("Arc_Testnet");
  });

  it("throws UnsupportedSwapChainError for an unknown chain id", () => {
    expect(() => createContraflowSwapKit(generatePrivateKey(), 999999)).toThrowError(/no SwapChain enum mapping/);
  });
});

describe("estimateUsdcToEurcSwap against the real Circle Swap Kit service", () => {
  it(
    "returns a real quote for 1 USDC -> EURC on Arc testnet (no API key, no funds moved)",
    async () => {
      const swapKit = createContraflowSwapKit(generatePrivateKey(), ARC_TESTNET_CHAIN_ID);

      const estimate = await estimateUsdcToEurcSwap({ swapKit, amountInUsdc: "1.00" });

      expect(estimate.estimatedOutput.token).toBe("EURC");
      expect(Number(estimate.estimatedOutput.amount)).toBeGreaterThan(0);
    },
    30_000,
  );
});
