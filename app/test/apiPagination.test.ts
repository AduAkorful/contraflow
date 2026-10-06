import { describe, expect, it } from "vitest";
import { paginatePartyLists, parsePageCursor, parsePageLimit } from "../src/api/pagination";

describe("obligation list pagination", () => {
  it("defaults the limit to 50 and rejects a non-integer", () => {
    expect(parsePageLimit(new URLSearchParams())).toBe(50);
    expect(parsePageLimit(new URLSearchParams("limit=2"))).toBe(2);
    expect(() => parsePageLimit(new URLSearchParams("limit=0"))).toThrow(/limit/);
    expect(() => parsePageLimit(new URLSearchParams("limit=101"))).toThrow(/limit/);
    expect(() => parsePageLimit(new URLSearchParams("limit=x"))).toThrow(/limit/);
  });

  it("pages proposals then obligations then certificates, and yields a cursor", () => {
    const first = paginatePartyLists(
      [{ token: "p1" }, { token: "p2" }],
      [{ obligationId: "o1" }],
      [{ token: "c1" }],
      2,
      null,
    );
    expect(first).toEqual({
      proposals: [{ token: "p1" }, { token: "p2" }],
      obligations: [],
      certificates: [],
      nextCursor: expect.any(String),
    });
    const second = paginatePartyLists(
      [{ token: "p1" }, { token: "p2" }],
      [{ obligationId: "o1" }],
      [{ token: "c1" }],
      2,
      first.nextCursor,
    );
    expect(second.obligations).toEqual([{ obligationId: "o1" }]);
    expect(second.certificates).toEqual([{ token: "c1" }]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a cursor that isn't base64url of kind:id", () => {
    expect(parsePageCursor(new URLSearchParams())).toBeNull();
    expect(() => parsePageCursor(new URLSearchParams("cursor=%%%"))).toThrow(/cursor/);
    expect(() => paginatePartyLists([], [], [], 1, "not-a-cursor")).toThrow(/cursor/);
  });
});
