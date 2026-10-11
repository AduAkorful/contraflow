import { describe, expect, it } from "vitest";
import { waitFor } from "../src/session/waitFor";

describe("waitFor", () => {
  it("resolves true as soon as the check passes", async () => {
    let ready = false;
    setTimeout(() => (ready = true), 30);
    expect(await waitFor(() => ready, 1000, 5)).toBe(true);
  });
  it("resolves true at once when already ready, false on timeout", async () => {
    expect(await waitFor(() => true, 0)).toBe(true);
    expect(await waitFor(() => false, 20, 5)).toBe(false);
  });
});
