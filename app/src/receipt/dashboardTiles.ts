/// Pure computation of the Receipt/dashboard tiles — deliberately isolated from any chain/UI
/// code so it can be unit-tested with plain numbers and never drifts toward hardcoding
/// illustrative placeholder KPIs as if they were live telemetry.

import type { SettleResult } from "../actions/settle";

export interface DashboardTiles {
  /// sum(wNet * cycleLength) over the settle — "how much invoice face value was cancelled".
  grossCancelledUsdc: bigint;
  /// Always 0 for a pure cancel — no token ever moves in `settle()`.
  cashMovedUsdc: bigint;
  /// `grossCancelled / max(cashMoved, 1)`, or `null` when cashMoved is exactly 0 (display
  /// "no cash moved" rather than a division-by-zero artifact — that phrasing is rendered by the
  /// UI layer, not computed as a literal Infinity here).
  multiplier: number | null;
  /// Native USDC (18 decimals) actually spent on gas for the settle tx.
  gasPaidWei: bigint;
}

export function computeDashboardTiles(result: SettleResult): DashboardTiles {
  const cycleLength = BigInt(result.invoiceIds.length);
  const grossCancelledUsdc = result.wNet * cycleLength;
  const cashMovedUsdc = 0n;

  return {
    grossCancelledUsdc,
    cashMovedUsdc,
    multiplier: cashMovedUsdc === 0n ? null : Number(grossCancelledUsdc) / Number(cashMovedUsdc),
    gasPaidWei: result.gasPaidWei,
  };
}
