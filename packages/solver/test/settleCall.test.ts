import { describe, expect, it } from "vitest";
import { buildSettleCall, wNetOf } from "../src/settleCall.js";
import type { Cycle, InvoiceEdge, Address } from "../src/types.js";

function addr(n: number): Address {
  return `0x${n.toString(16).padStart(40, "0")}` as Address;
}
function edge(id: string, debtor: Address, creditor: Address, amount: bigint): InvoiceEdge {
  return { id: id as `0x${string}`, debtor, creditor, amountRemaining: amount };
}

const A = addr(1);
const B = addr(2);
const C = addr(3);

describe("wNetOf", () => {
  it("returns the minimum amountRemaining across the cycle's edges", () => {
    const cycle: Cycle = {
      edges: [edge("0x1", A, B, 300n), edge("0x2", B, C, 100n), edge("0x3", C, A, 200n)],
    };
    expect(wNetOf(cycle)).toBe(100n);
  });

  it("throws on an empty cycle", () => {
    expect(() => wNetOf({ edges: [] })).toThrow();
  });
});

describe("buildSettleCall", () => {
  it("returns invoiceIds in cycle order and the correct wNet", () => {
    const cycle: Cycle = {
      edges: [edge("0x1", A, B, 300n), edge("0x2", B, C, 100n), edge("0x3", C, A, 200n)],
    };
    const call = buildSettleCall(cycle);
    expect(call.invoiceIds).toEqual(["0x1", "0x2", "0x3"]);
    expect(call.wNet).toBe(100n);
  });
});
