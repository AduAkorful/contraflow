import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_RUN_EXPIRED_MESSAGE,
  demoRunIdsMatch,
  loadDemoRunInvoiceIds,
  rememberDemoRunInvoiceId,
} from "../src/demo/runIds";

const get = vi.fn();
const set = vi.fn();
vi.mock("../src/upstash/client", () => ({
  redis: () => ({ get, set }),
}));

const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const HASH_C = `0x${"c".repeat(64)}`;

describe("demo run invoice ids", () => {
  beforeEach(() => {
    get.mockReset();
    set.mockReset();
  });

  it("records each registered id and refreshes the TTL", async () => {
    get.mockResolvedValueOnce([HASH_A]);
    set.mockResolvedValueOnce("OK");

    await rememberDemoRunInvoiceId("run-1", `0x${"B".repeat(64)}`);

    expect(set).toHaveBeenCalledWith(
      "demo:run:run-1:ids",
      [HASH_A, HASH_B],
      { ex: 2 * 60 * 60 },
    );
  });

  it("loads stored ids, or missing when the TTL has elapsed", async () => {
    get.mockResolvedValueOnce([HASH_A, HASH_B, HASH_C]);
    await expect(loadDemoRunInvoiceIds("run-1")).resolves.toEqual({
      kind: "ids",
      ids: [HASH_A, HASH_B, HASH_C],
    });

    get.mockResolvedValueOnce(null);
    await expect(loadDemoRunInvoiceIds("run-1")).resolves.toEqual({ kind: "missing" });
  });

  it("is unavailable when redis cannot be reached", async () => {
    get.mockRejectedValueOnce(new Error("down"));
    await expect(loadDemoRunInvoiceIds("run-1")).resolves.toEqual({ kind: "unavailable" });
  });

  it("matches a recorded run regardless of request order or casing", () => {
    expect(demoRunIdsMatch([HASH_A, HASH_B, HASH_C], [HASH_C.toUpperCase(), HASH_A, HASH_B])).toBe(true);
    expect(demoRunIdsMatch([HASH_A, HASH_B, HASH_C], [HASH_A, HASH_B, `0x${"d".repeat(64)}`])).toBe(false);
    expect(demoRunIdsMatch([HASH_A, HASH_B, HASH_C], [HASH_A, HASH_B])).toBe(false);
  });
});

describe("DEMO_RUN_EXPIRED_MESSAGE", () => {
  it("is the copy settle uses when the record is gone", () => {
    expect(DEMO_RUN_EXPIRED_MESSAGE).toBe("This demo run has expired. Start a new one.");
  });
});
