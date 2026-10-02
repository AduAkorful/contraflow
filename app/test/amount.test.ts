import { describe, expect, it } from "vitest";
import { formatUsdcAmount, formatUsdcDisplay, parseUsdcAmount, UsdcAmountError } from "../src/attest/amount";

describe("exact USDC amount conversion", () => {
  it.each([["1.005", 1_005_000n], ["0.000001", 1n], ["42", 42_000_000n]] as const)(
    "parses %s without floating point",
    (input, expected) => expect(parseUsdcAmount(input)).toBe(expected),
  );

  it.each(["0", "1.0000001", "1e-6", "-1", "1.", "1,000"])("rejects invalid decimal %s", (input) => {
    expect(() => parseUsdcAmount(input)).toThrow(UsdcAmountError);
  });

  it("preserves display precision, including zero and large aggregates", () => {
    expect(formatUsdcAmount(1_005_000n)).toBe("1.005");
    expect(formatUsdcAmount(1n)).toBe("0.000001");
    expect(formatUsdcDisplay(0n)).toBe("0.00");
    expect(formatUsdcDisplay((1n << 256n) * 100_000_000n)).toBe("11579208923731619542357098500868790785326998466564056403945758400791312963993600.00");
  });
});
