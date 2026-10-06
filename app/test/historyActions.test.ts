import { describe, expect, it } from "vitest";
import { historyPartyActionFlags } from "../components/history/HistoryTable";

describe("history row party actions", () => {
  it("hides quote and Bring USDC on a public lookup", () => {
    expect(
      historyPartyActionFlags({ viewingOwn: false, stillOwed: true, isDebtor: true, unifiedBalance: true }),
    ).toEqual({ quote: false, bringUsdc: false });
  });

  it("shows quote on the signed-in party's own remaining invoices", () => {
    expect(
      historyPartyActionFlags({ viewingOwn: true, stillOwed: true, isDebtor: false, unifiedBalance: true }),
    ).toEqual({ quote: true, bringUsdc: false });
    expect(
      historyPartyActionFlags({ viewingOwn: true, stillOwed: true, isDebtor: true, unifiedBalance: true }),
    ).toEqual({ quote: true, bringUsdc: true });
    expect(
      historyPartyActionFlags({ viewingOwn: true, stillOwed: false, isDebtor: true, unifiedBalance: true }),
    ).toEqual({ quote: false, bringUsdc: false });
  });
});
