import { describe, expect, it } from "vitest";
import { isUserRejection } from "../src/wallet/rejection";

describe("isUserRejection", () => {
  it("sees the provider's 4001 at the top and several causes down", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    const wrapped = Object.assign(new Error("Transaction failed"), {
      cause: Object.assign(new Error("RPC error"), { cause: { code: 4001, message: "User rejected the request." } }),
    });
    expect(isUserRejection(wrapped)).toBe(true);
  });

  it("knows viem's and ethers-style names", () => {
    expect(isUserRejection({ name: "UserRejectedRequestError", message: "x" })).toBe(true);
    expect(isUserRejection({ code: "ACTION_REJECTED" })).toBe(true);
    expect(isUserRejection(new Error("User denied transaction signature"))).toBe(true);
  });

  it("doesn't mistake a lost connection or a revert for a refusal", () => {
    expect(isUserRejection(new Error("fetch failed"))).toBe(false);
    expect(isUserRejection({ code: -32000, message: "insufficient funds" })).toBe(false);
    expect(isUserRejection(null)).toBe(false);
    expect(isUserRejection("rejected")).toBe(false);
  });
});
