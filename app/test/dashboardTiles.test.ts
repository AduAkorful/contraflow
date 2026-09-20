import { describe, expect, it } from "vitest";
import { computeDashboardTiles } from "../src/receipt/dashboardTiles";
import type { SettleResult } from "../src/actions/settle";

function sampleResult(overrides: Partial<SettleResult> = {}): SettleResult {
  return {
    invoiceIds: ["0xaa", "0xbb", "0xcc"],
    wNet: 250_000_000n, // 250 USDC
    txHash: "0xdeadbeef",
    blockNumber: 1n,
    gasPaidWei: 12_345n,
    ...overrides,
  };
}

describe("computeDashboardTiles", () => {
  it("gross cancelled is wNet times cycle length", () => {
    const tiles = computeDashboardTiles(sampleResult());
    expect(tiles.grossCancelledUsdc).toBe(750_000_000n); // 250 * 3
  });

  it("cash moved is always 0 for a pure cancel", () => {
    expect(computeDashboardTiles(sampleResult()).cashMovedUsdc).toBe(0n);
  });

  it("multiplier is null (not Infinity/NaN) when cash moved is 0", () => {
    expect(computeDashboardTiles(sampleResult()).multiplier).toBeNull();
  });

  it("passes gas paid straight through", () => {
    const tiles = computeDashboardTiles(sampleResult({ gasPaidWei: 999n }));
    expect(tiles.gasPaidWei).toBe(999n);
  });

  it("scales with a 5-invoice cycle", () => {
    const tiles = computeDashboardTiles(
      sampleResult({ invoiceIds: ["0x1", "0x2", "0x3", "0x4", "0x5"], wNet: 100_000_000n }),
    );
    expect(tiles.grossCancelledUsdc).toBe(500_000_000n);
  });
});
