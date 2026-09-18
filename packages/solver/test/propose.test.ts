import { describe, expect, it } from "vitest";
import { proposeSettleCall } from "../src/propose.js";
import type { InvoiceEdge, Address } from "../src/types.js";

function addr(n: number): Address {
  return `0x${n.toString(16).padStart(40, "0")}` as Address;
}
function edge(id: string, debtor: Address, creditor: Address, amount: bigint): InvoiceEdge {
  return { id: id as `0x${string}`, debtor, creditor, amountRemaining: amount };
}

const A = addr(1);
const B = addr(2);
const C = addr(3);
const D = addr(4);

describe("proposeSettleCall", () => {
  it("returns null when no valid cycle exists", () => {
    const invoices = [edge("0x1", A, B, 100n), edge("0x2", B, C, 100n)]; // DAG, no cycle
    expect(proposeSettleCall(invoices)).toBeNull();
  });

  it("picks the cycle with maximum wNet when multiple exist (spec §3.3)", () => {
    const invoices = [
      // Cycle 1: A->B->C->A, min amount 100
      edge("0x1", A, B, 100n),
      edge("0x2", B, C, 500n),
      edge("0x3", C, A, 500n),
      // Cycle 2: A->D->C->A (distinct invoices), min amount 400 -- larger than cycle 1's 100
      edge("0x4", A, D, 400n),
      edge("0x5", D, C, 400n),
      edge("0x6", C, A, 500n),
    ];
    const call = proposeSettleCall(invoices);
    expect(call).not.toBeNull();
    expect(call!.wNet).toBe(400n);
  });

  it("is deterministic across repeated calls on the same input", () => {
    const invoices = [edge("0x1", A, B, 100n), edge("0x2", B, C, 100n), edge("0x3", C, A, 100n)];
    const first = proposeSettleCall(invoices);
    const second = proposeSettleCall(invoices);
    expect(first).toEqual(second);
  });

  it("end-to-end: proposes exactly the cycle and wNet that a real settle() call already used (mirrors SET-01)", () => {
    // Same shape as plans/03-live-testnet-e2e-tests.md SET-01: 3-cycle, equal amounts, settled
    // with wNet = half the invoice amount.
    const invoices = [edge("0x1", A, B, 1_000_000n), edge("0x2", B, C, 1_000_000n), edge("0x3", C, A, 1_000_000n)];
    const call = proposeSettleCall(invoices);
    expect(call).toEqual({ invoiceIds: ["0x1", "0x2", "0x3"], wNet: 1_000_000n });
  });
});
