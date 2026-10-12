import { describe, expect, it } from "vitest";
import { displayDateTimeUtc } from "../src/format/dateTime";

describe("displayDateTimeUtc", () => {
  it("prints one stable format in UTC", () => {
    expect(displayDateTimeUtc("2026-10-12T13:13:09.000Z")).toBe("12 October 2026, 13:13 UTC");
    expect(displayDateTimeUtc(Date.parse("2026-12-31T22:29:00Z"))).toBe("31 December 2026, 22:29 UTC");
  });
  it("prints nothing for an unreadable value", () => {
    expect(displayDateTimeUtc("not a date")).toBe("");
  });
});
