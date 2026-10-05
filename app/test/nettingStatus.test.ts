import { describe, expect, it } from "vitest";
import { nettingStatus, NETTING_STATUS_LABEL } from "../src/format/netting";
import { usdcBaseUnits } from "../src/format/money";

describe("nettingStatus", () => {
  it.each([
    ["1000.00", null, "open"],
    ["1000.00", "1000.00", "open"],
    ["1000.00", "400.00", "partly"],
    ["1000.00", "0.000001", "partly"],
    ["1000.00", "0.00", "fully"],
    ["1000.00", "0", "fully"],
    ["1000.00", "garbage", "open"],
    ["1e3", "0.00", "open"],
  ])("amount %s remaining %s is %s", (amount, remaining, expected) => {
    expect(nettingStatus(amount, remaining)).toBe(expected);
  });
  it("never uses the word cancelled", () => {
    expect(Object.values(NETTING_STATUS_LABEL).join(" ")).not.toMatch(/cancel/i);
  });
});

describe("usdcBaseUnits", () => {
  it("is exact and strict", () => {
    expect(usdcBaseUnits("1650.5")).toBe(1_650_500_000n);
    expect(usdcBaseUnits("0.000001")).toBe(1n);
    expect(usdcBaseUnits("0.0000001")).toBeNull();
    expect(usdcBaseUnits("-1")).toBeNull();
    expect(usdcBaseUnits("")).toBeNull();
  });
});
