import { describe, expect, it } from "vitest";
import { appNavItems, isNavActive } from "../components/app-shell/nav";

const items = appNavItems({ balance: true });
const active = (path: string) => items.filter((i) => isNavActive(i, path)).map((i) => i.label);

describe("app navigation", () => {
  it("marks exactly one item active on each app path", () => {
    expect(active("/app")).toEqual(["Overview"]);
    expect(active("/app/attest")).toEqual(["Send invoice"]);
    expect(active("/app/attest/abc123")).toEqual(["Send invoice"]);
    expect(active("/app/i/AbCdEf123_-xxxxxxxx")).toEqual(["Send invoice"]);
    expect(active("/app/history")).toEqual(["History"]);
    expect(active("/app/receipt/0xabc")).toEqual(["History"]);
    expect(active("/app/obligations/new")).toEqual(["Obligations"]);
    expect(active("/app/o/token123")).toEqual(["Obligations"]);
    expect(active("/app/c/token123")).toEqual(["Obligations"]);
    expect(active("/app/balance")).toEqual(["Balance"]);
    expect(active("/app/verify")).toEqual(["Verify"]);
    expect(active("/app/demo")).toEqual(["Demo"]);
  });
  it("doesn't treat a look-alike prefix as a match", () => {
    expect(active("/app/attestation")).toEqual([]);
    expect(active("/app/obligationsx")).toEqual([]);
  });
  it("leaves Balance out when the feature is off", () => {
    expect(appNavItems({ balance: false }).map((i) => i.label)).not.toContain("Balance");
  });
});
