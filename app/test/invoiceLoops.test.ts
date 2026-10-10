import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { InvoiceEdge } from "@contraflow/solver";
import {
  findInvoiceLoopFor,
  INVOICE_SEARCH_MAX_VERTICES,
  neighbourhoodInvoiceEdges,
  proposeInvoiceLoop,
  registeredInvoiceEdges,
} from "../src/settle/invoiceLoops";
import { settleLoopSentence } from "../src/settle/copy";
import type { DecodedLog } from "../src/blockscout/client";

const party = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6].map(party) as [Address, Address, Address, Address, Address, Address];

let n = 0;
function id(): Hex {
  n += 1;
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}
function edge(debtor: Address, creditor: Address, remaining: bigint): InvoiceEdge {
  return { id: id(), debtor, creditor, amountRemaining: remaining };
}

describe("proposeInvoiceLoop", () => {
  it("finds 3-, 4- and 5-loops through the caller", () => {
    const three = [edge(A, B, 40_000_000n), edge(B, C, 70_000_000n), edge(C, A, 50_000_000n)];
    const threeResult = proposeInvoiceLoop(three, C);
    expect(threeResult.kind).toBe("loop");
    if (threeResult.kind === "loop") expect(threeResult.wNet).toBe(40_000_000n);

    const fourOnly = [edge(A, B, 10n), edge(B, C, 10n), edge(C, D, 10n), edge(D, A, 10n)];
    expect(proposeInvoiceLoop(fourOnly, A).kind).toBe("loop");

    const five = [edge(A, B, 5n), edge(B, C, 5n), edge(C, D, 5n), edge(D, E, 5n), edge(E, A, 5n)];
    expect(proposeInvoiceLoop(five, D).kind).toBe("loop");
  });

  it("finds the loop when chain reads return checksummed addresses", () => {
    const X = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
    const Y = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
    const Z = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
    const loop = [edge(X, Y, 10n), edge(Y, Z, 10n), edge(Z, X, 10n)];
    expect(proposeInvoiceLoop(loop, X).kind).toBe("loop");
    expect(proposeInvoiceLoop(loop, X.toLowerCase() as Address).kind).toBe("loop");
  });

  it("ignores a loop that does not contain the caller", () => {
    const others = [edge(B, C, 100n), edge(C, D, 100n), edge(D, B, 100n)];
    expect(proposeInvoiceLoop(others, A)).toEqual({ kind: "none" });
  });

  it("rejects a walk that visits a party twice", () => {
    const duplicate = [edge(A, B, 10n), edge(B, A, 10n), edge(A, C, 10n), edge(C, A, 10n)];
    const result = proposeInvoiceLoop(duplicate, A);
    if (result.kind === "loop") {
      const parties = result.legs.flatMap((leg) => [leg.debtor, leg.creditor]);
      expect(new Set(parties).size).toBe(result.legs.length);
    }
  });

  it("does not propose a 2-party invoice loop", () => {
    expect(proposeInvoiceLoop([edge(A, B, 10n), edge(B, A, 10n)], A)).toEqual({ kind: "none" });
  });

  it("reports incomplete when the neighbourhood exceeds the vertex cap", () => {
    const edges: InvoiceEdge[] = [];
    for (let i = 0; i < INVOICE_SEARCH_MAX_VERTICES; i++) {
      const extra = party(100 + i);
      edges.push(edge(A, extra, 1n), edge(extra, A, 1n));
    }
    expect(proposeInvoiceLoop(edges, A).kind).toBe("incomplete");
  });
});

describe("findInvoiceLoopFor", () => {
  it("returns incomplete when the log window is truncated", async () => {
    const result = await findInvoiceLoopFor(A, {
      fetchLogs: async () => ({ logs: [], truncated: true }),
      fetchNettable: async () => [],
      filterFlagged: async (edges) => edges,
    });
    expect(result).toEqual({ kind: "incomplete" });
  });

  it("drops flagged parties before proposing", async () => {
    const loop = [edge(A, B, 40n), edge(B, C, 40n), edge(C, A, 40n)];
    const result = await findInvoiceLoopFor(A, {
      fetchLogs: async () => ({ logs: registeredLogs(loop), truncated: false }),
      fetchNettable: async (ids) => loop.filter((e) => ids.includes(e.id)),
      filterFlagged: async (edges) => edges.filter((e) => e.debtor !== C && e.creditor !== C),
    });
    expect(result.kind).toBe("none");
  });

  it("re-reads nettable edges so a not-yet-matured invoice is excluded", async () => {
    const loop = [edge(A, B, 40n), edge(B, C, 40n), edge(C, A, 40n)];
    const result = await findInvoiceLoopFor(A, {
      fetchLogs: async () => ({ logs: registeredLogs(loop), truncated: false }),
      fetchNettable: async (ids) => loop.filter((e) => ids.includes(e.id) && e.debtor !== B),
      filterFlagged: async (edges) => edges,
    });
    expect(result.kind).toBe("none");
  });
});

describe("neighbourhoodInvoiceEdges", () => {
  it("keeps only edges that can close a loop through the caller within max length", () => {
    const loop = [edge(A, B, 1n), edge(B, C, 1n), edge(C, A, 1n)];
    const elsewhere = [edge(D, E, 1n), edge(E, F, 1n), edge(F, D, 1n)];
    const kept = neighbourhoodInvoiceEdges([...loop, ...elsewhere], A);
    expect(kept.map((e) => e.id).sort()).toEqual(loop.map((e) => e.id).sort());
  });
});

describe("settleLoopSentence", () => {
  it("prints grouped USDC, never a $ template", () => {
    expect(settleLoopSentence(3, "40000000")).toBe(
      "3 invoices form a loop: 40.00 USDC netted from each, 120.00 USDC netted in total, no cash moves",
    );
  });
});

function registeredLogs(edges: InvoiceEdge[]): DecodedLog[] {
  return edges.map((e) => ({
    transactionHash: e.id,
    blockNumber: 1,
    methodCall: "InvoiceRegistered(bytes32 indexed id, address indexed debtor, address indexed creditor, uint256 amount, uint64 maturity, bool earlyNetConsent, uint256 nonce)",
    parameters: [
      { name: "id", type: "bytes32", value: e.id },
      { name: "debtor", type: "address", value: e.debtor },
      { name: "creditor", type: "address", value: e.creditor },
      { name: "amount", type: "uint256", value: e.amountRemaining.toString() },
      { name: "maturity", type: "uint64", value: "1" },
      { name: "earlyNetConsent", type: "bool", value: "true" },
      { name: "nonce", type: "uint256", value: "1" },
    ],
  }));
}

describe("registeredInvoiceEdges", () => {
  it("keeps only 32-byte invoice ids", () => {
    const logs = registeredLogs([edge(A, B, 1n)]);
    logs[0]!.parameters[0] = { name: "id", type: "bytes32", value: "0xid" };
    expect(registeredInvoiceEdges(logs)).toEqual([]);
  });
});
