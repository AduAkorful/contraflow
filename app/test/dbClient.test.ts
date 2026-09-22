import { describe, expect, it, vi } from "vitest";
import { withDbRetry } from "../src/db/client";

describe("withDbRetry", () => {
  it("returns the result immediately on success, no retry", async () => {
    const fn = vi.fn().mockResolvedValueOnce("ok");
    await expect(withDbRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a 'fetch failed' error and succeeds on a later attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Error connecting to database: fetch failed"))
      .mockResolvedValueOnce("ok");
    await expect(withDbRetry(fn, 3)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up and throws after exhausting attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(withDbRetry(fn, 3)).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-transient error (e.g. a real SQL error)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("syntax error at or near \"SELCT\""));
    await expect(withDbRetry(fn, 3)).rejects.toThrow("syntax error");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
