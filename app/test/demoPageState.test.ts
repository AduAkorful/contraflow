import { describe, expect, it } from "vitest";
import { formatUsdc } from "../src/format/money";
import { demoEdgeAmountUsdc } from "../src/fixtures/demoCycle";
import {
  afterSettleFailure,
  demoEdgeAmountLabel,
  demoIdleEdges,
  demoLeadSentence,
  demoMinAmountUsdc,
  demoNetToSettleLabel,
} from "../src/demo/pageState";

describe("demo idle preview", () => {
  it("pre-fills edge amounts for a static loop", () => {
    const edges = demoIdleEdges("preview", 3);
    expect(edges).toHaveLength(3);
    for (const [i, edge] of edges.entries()) {
      expect(edge.status).toBe("preview");
      expect(edge.amountUsdc).toBe(String(demoEdgeAmountUsdc(i, "preview")));
      expect(edge.fromLabel.length).toBeGreaterThan(0);
    }
    expect(edges[0]!.toLabel).toBe(edges[1]!.fromLabel);
    expect(edges[2]!.toLabel).toBe(edges[0]!.fromLabel);
  });
});

describe("demo lead copy", () => {
  it("uses the run's amounts and the min as the net, never hard-coded figures", () => {
    const sentence = demoLeadSentence(3, "preview");
    const amounts = [0, 1, 2].map((i) => formatUsdc(String(demoEdgeAmountUsdc(i, "preview"))));
    const wNet = formatUsdc(demoMinAmountUsdc(3, "preview"));
    for (const amount of amounts) expect(sentence).toContain(amount);
    expect(sentence).toContain(`Watch one transaction net ${wNet} of it.`);
    expect(sentence.startsWith("3 companies owe each other")).toBe(true);
  });
});

describe("demo amount labels", () => {
  it("prints registered and preview amounts the same way Money does", () => {
    expect(demoEdgeAmountLabel("preview", "1800")).toBe("1,800.00 USDC");
    expect(demoEdgeAmountLabel("registered", "1150")).toBe("1,150.00 USDC");
    expect(demoNetToSettleLabel("1150")).toBe("1,150.00 USDC");
    expect(demoNetToSettleLabel("1150")).not.toMatch(/^\$/);
  });
});

describe("afterSettleFailure", () => {
  it("resets edges to registered, sets a failed centre, and disables settle", () => {
    const edges = [
      { fromLabel: "A", toLabel: "B", status: "settling" as const, amountUsdc: "1800", explorerUrl: "https://explorer.testnet.arc.io/tx/0x1" },
      { fromLabel: "B", toLabel: "C", status: "settling" as const, amountUsdc: "900", explorerUrl: "https://explorer.testnet.arc.io/tx/0x2" },
      { fromLabel: "C", toLabel: "A", status: "settling" as const, amountUsdc: "1150", explorerUrl: "https://explorer.testnet.arc.io/tx/0x3" },
    ];
    const next = afterSettleFailure(edges);
    expect(next.phase).toBe("settleFailed");
    expect(next.settleDisabled).toBe(true);
    expect(next.center).toEqual({ kind: "failed" });
    expect(next.edges.every((edge) => edge.status === "registered")).toBe(true);
    expect(next.edges.map((edge) => edge.explorerUrl)).toEqual(edges.map((edge) => edge.explorerUrl));
  });
});
