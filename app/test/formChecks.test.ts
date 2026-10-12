import { describe, expect, it } from "vitest";
import { isZeroAddress, pastMaturityNote } from "../src/format/formChecks";

describe("composer field checks", () => {
  const now = new Date("2026-10-12T10:00:00Z");

  it("notes a maturity date that has passed, and says nothing for today or later", () => {
    expect(pastMaturityNote("2020-01-01", now)).toMatch(/already passed/);
    expect(pastMaturityNote("2026-10-12", now)).toBeNull();
    expect(pastMaturityNote("2026-12-31", now)).toBeNull();
    expect(pastMaturityNote("", now)).toBeNull();
  });

  it("recognises the zero address however it is written", () => {
    expect(isZeroAddress("0x0000000000000000000000000000000000000000")).toBe(true);
    expect(isZeroAddress(" 0x0000000000000000000000000000000000000000 ")).toBe(true);
    expect(isZeroAddress("0x0000000000000000000000000000000000000001")).toBe(false);
  });
});
