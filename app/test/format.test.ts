import { describe, expect, it } from "vitest";
import { checksumAddress, formatAddress } from "../src/format/address";
import { formatUsdc, formatUsdcNumber, sumUsdc } from "../src/format/money";

describe("formatAddress", () => {
  const lower = "0x82d4dbff850256d15125107b287330b6596e1a16";
  it("checksums and keeps 0x + 4 … 4", () => {
    expect(checksumAddress(lower)).toBe("0x82d4dBff850256d15125107B287330B6596E1A16");
    expect(formatAddress(lower)).toBe("0x82d4…1A16");
  });
  it("returns unparseable input unchanged instead of throwing", () => {
    expect(formatAddress("not an address")).toBe("not an address");
  });
});

describe("formatUsdc", () => {
  it.each([
    ["2650", "2,650.00"],
    ["2650.5", "2,650.50"],
    ["0.002502", "0.002502"],
    ["1234567.123456", "1,234,567.123456"],
    ["100000000000000000000000", "100,000,000,000,000,000,000,000.00"],
    ["0", "0.00"],
  ])("formats %s", (input, expected) => expect(formatUsdcNumber(input)).toBe(expected));

  it("never reinterprets a value that isn't a plain decimal", () => {
    expect(formatUsdcNumber("1e+23")).toBe("1e+23");
  });
  it("adds the unit and accepts base units", () => {
    expect(formatUsdc("2650")).toBe("2,650.00 USDC");
    expect(formatUsdc(1_650_000_000n)).toBe("1,650.00 USDC");
  });
});

describe("sumUsdc", () => {
  it("adds exactly where floats drift", () => {
    expect(sumUsdc(["0.1", "0.2"])).toBe("0.30");
    expect(sumUsdc(["1650", "1000.000001"])).toBe("2650.000001");
  });
  it("rejects values it can't add exactly", () => {
    expect(() => sumUsdc(["1e3"])).toThrow();
    expect(() => sumUsdc(["0.1234567"])).toThrow();
  });
});
