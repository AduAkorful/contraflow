import type { Cycle, SettleCall } from "./types.js";

/** Spec §3.3: wNet = min(amountRemaining) over the chosen cycle's edges. This is exactly the
 * value ContraflowSettler.settle() will itself subtract from every invoice in the cycle. */
export function wNetOf(cycle: Cycle): bigint {
  let min: bigint | undefined;
  for (const edge of cycle.edges) {
    if (min === undefined || edge.amountRemaining < min) min = edge.amountRemaining;
  }
  if (min === undefined) throw new Error("wNetOf: cycle has no edges");
  return min;
}

export function buildSettleCall(cycle: Cycle): SettleCall {
  return {
    invoiceIds: cycle.edges.map((e) => e.id),
    wNet: wNetOf(cycle),
  };
}
