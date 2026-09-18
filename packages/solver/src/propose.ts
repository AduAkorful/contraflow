import { buildGraph } from "./graph.js";
import { findCycles, type FindCyclesOptions } from "./cycles.js";
import { buildSettleCall, wNetOf } from "./settleCall.js";
import type { InvoiceEdge, SettleCall } from "./types.js";

/** The one function the app actually calls: invoices in, best SettleCall out (or null if no
 * valid cycle exists). Wires buildGraph + findCycles + max-wNet selection + buildSettleCall so
 * callers don't need to know the algorithm's internal steps. Per spec §3.3: "First valid cycle
 * with maximum W_net is submitted" — enumerates every cycle within bounds, then picks the one
 * with the largest wNet; ties broken by enumeration order (deterministic — see cycles.ts's
 * least-vertex-rank convention) so the same input always proposes the same call. */
export function proposeSettleCall(invoices: InvoiceEdge[], opts?: FindCyclesOptions): SettleCall | null {
  const graph = buildGraph(invoices);
  const cycles = findCycles(graph, opts);
  if (cycles.length === 0) return null;

  let best = cycles[0]!;
  let bestWNet = wNetOf(best);
  for (let i = 1; i < cycles.length; i++) {
    const candidate = cycles[i]!;
    const candidateWNet = wNetOf(candidate);
    if (candidateWNet > bestWNet) {
      best = candidate;
      bestWNet = candidateWNet;
    }
  }

  return buildSettleCall(best);
}
