import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph.js";
import type { InvoiceEdge } from "../src/types.js";

const A = "0xA000000000000000000000000000000000000A";
const B = "0xB000000000000000000000000000000000000B";
const C = "0xC000000000000000000000000000000000000C";

function edge(id: string, debtor: string, creditor: string, amount: bigint): InvoiceEdge {
  return { id: id as `0x${string}`, debtor: debtor as `0x${string}`, creditor: creditor as `0x${string}`, amountRemaining: amount };
}

describe("buildGraph", () => {
  it("returns empty graph for empty input", () => {
    const g = buildGraph([]);
    expect(g.vertices).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("dedupes vertices across debtor/creditor roles", () => {
    const invoices = [edge("0x1", A, B, 100n), edge("0x2", B, C, 200n), edge("0x3", C, A, 300n)];
    const g = buildGraph(invoices);
    expect(new Set(g.vertices)).toEqual(new Set([A, B, C]));
    expect(g.vertices).toHaveLength(3);
  });

  it("preserves all edges, including parallel ones between the same pair", () => {
    const invoices = [edge("0x1", A, B, 100n), edge("0x2", A, B, 50n)];
    const g = buildGraph(invoices);
    expect(g.edges).toHaveLength(2);
  });
});
