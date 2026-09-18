import { describe, expect, it } from "vitest";
import { findCycles, GraphTooLargeError } from "../src/cycles.js";
import { buildGraph } from "../src/graph.js";
import type { InvoiceEdge, InvoiceId, Address } from "../src/types.js";

function addr(n: number): Address {
  return `0x${n.toString(16).padStart(40, "0")}` as Address;
}
function edge(id: string, debtor: Address, creditor: Address, amount = 100n): InvoiceEdge {
  return { id: id as `0x${string}`, debtor, creditor, amountRemaining: amount };
}

const A = addr(1);
const B = addr(2);
const C = addr(3);
const D = addr(4);
const E = addr(5);

describe("findCycles", () => {
  it("finds a simple 3-cycle", () => {
    const invoices = [edge("0x1", A, B), edge("0x2", B, C), edge("0x3", C, A)];
    const cycles = findCycles(buildGraph(invoices));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.edges.map((e) => e.id)).toEqual(["0x1", "0x2", "0x3"]);
  });

  it("finds a 4-cycle", () => {
    const invoices = [edge("0x1", A, B), edge("0x2", B, C), edge("0x3", C, D), edge("0x4", D, A)];
    const cycles = findCycles(buildGraph(invoices));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.edges).toHaveLength(4);
  });

  it("finds a 5-cycle (max length)", () => {
    const invoices = [
      edge("0x1", A, B),
      edge("0x2", B, C),
      edge("0x3", C, D),
      edge("0x4", D, E),
      edge("0x5", E, A),
    ];
    const cycles = findCycles(buildGraph(invoices));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.edges).toHaveLength(5);
  });

  it("does not return a 2-length shape (below the [3,5] default minimum)", () => {
    const invoices = [edge("0x1", A, B), edge("0x2", B, A)];
    const cycles = findCycles(buildGraph(invoices));
    expect(cycles).toHaveLength(0);
  });

  it("does not return a 6-length shape (above the [3,5] default maximum)", () => {
    const F = addr(6);
    const invoices = [
      edge("0x1", A, B),
      edge("0x2", B, C),
      edge("0x3", C, D),
      edge("0x4", D, E),
      edge("0x5", E, F),
      edge("0x6", F, A),
    ];
    const cycles = findCycles(buildGraph(invoices));
    expect(cycles).toHaveLength(0);
  });

  it("prunes a pure DAG to zero cycles (Tarjan correctly drops acyclic components)", () => {
    const invoices = [edge("0x1", A, B), edge("0x2", B, C)]; // A->B->C, no return edge
    const cycles = findCycles(buildGraph(invoices));
    expect(cycles).toHaveLength(0);
  });

  it("finds two independent cycles that don't interfere (mirrors SET-14)", () => {
    const F = addr(6);
    const invoices = [
      edge("0x1", A, B),
      edge("0x2", B, C),
      edge("0x3", C, A),
      edge("0x4", D, E),
      edge("0x5", E, F),
      edge("0x6", F, D),
    ];
    const cycles = findCycles(buildGraph(invoices));
    expect(cycles).toHaveLength(2);
  });

  it("finds two cycles sharing one edge (mirrors RACE-03)", () => {
    const invoices = [
      edge("0x1", A, B), // shared
      edge("0x2", B, C),
      edge("0x3", C, A),
      edge("0x4", B, D),
      edge("0x5", D, A),
    ];
    const cycles = findCycles(buildGraph(invoices));
    expect(cycles).toHaveLength(2);
    const idSets = cycles.map((c) => new Set(c.edges.map((e) => e.id)));
    const expected: Set<InvoiceId>[] = [
      new Set<InvoiceId>(["0x1", "0x2", "0x3"]),
      new Set<InvoiceId>(["0x1", "0x4", "0x5"]),
    ];
    for (const exp of expected) {
      expect(idSets.some((actual) => actual.size === exp.size && [...exp].every((id) => actual.has(id)))).toBe(true);
    }
  });

  it("finds a non-distinct-party closed walk revisiting the same two addresses (mirrors SET-16, proven live on testnet)", () => {
    const invoices = [
      edge("0x1", A, B),
      edge("0x2", B, A),
      edge("0x3", A, B),
      edge("0x4", B, A),
    ];
    const cycles = findCycles(buildGraph(invoices));
    // Must find at least one valid 4-length closed walk using 4 distinct invoice ids, even
    // though it only touches 2 distinct addresses -- an elementary-cycle-only search would
    // wrongly find zero here.
    const fourLength = cycles.filter((c) => c.edges.length === 4);
    expect(fourLength.length).toBeGreaterThan(0);
    for (const c of fourLength) {
      expect(new Set(c.edges.map((e) => e.id)).size).toBe(4); // no invoice id reused within one cycle
    }
  });

  it("never reuses the same invoice id twice within one returned cycle", () => {
    const invoices = [edge("0x1", A, B), edge("0x2", B, C), edge("0x3", C, A), edge("0x4", A, B, 50n)];
    const cycles = findCycles(buildGraph(invoices));
    for (const c of cycles) {
      const ids = c.edges.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("throws GraphTooLargeError above the default 32-vertex cap", () => {
    const invoices: InvoiceEdge[] = [];
    for (let i = 0; i < 33; i++) {
      invoices.push(edge(`0x${i}`, addr(i), addr((i + 1) % 33)));
    }
    expect(() => findCycles(buildGraph(invoices))).toThrow(GraphTooLargeError);
  });

  it("respects a custom maxVertices option", () => {
    const invoices = [edge("0x1", A, B), edge("0x2", B, C), edge("0x3", C, A)];
    expect(() => findCycles(buildGraph(invoices), { maxVertices: 2 })).toThrow(GraphTooLargeError);
  });

  it("caps enumeration at maxCycles on a dense graph without hanging", () => {
    // A small dense complete-ish graph produces many 3-cycles.
    const vertices = Array.from({ length: 8 }, (_, i) => addr(i + 1));
    const invoices: InvoiceEdge[] = [];
    let counter = 0;
    for (const from of vertices) {
      for (const to of vertices) {
        if (from !== to) invoices.push(edge(`0x${(counter++).toString(16)}`, from, to));
      }
    }
    const cycles = findCycles(buildGraph(invoices), { maxCycles: 10 });
    expect(cycles.length).toBeLessThanOrEqual(10);
  });

  it("returns an empty array for an empty graph", () => {
    expect(findCycles(buildGraph([]))).toEqual([]);
  });
});
