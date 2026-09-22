import { describe, expect, it } from "vitest";
import { isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveDemoParties, MIN_DEMO_PARTIES, MAX_DEMO_PARTIES } from "../src/fixtures/demoIdentities";

describe("demo party identities", () => {
  it("derives a valid, distinct address for each party, for every allowed count", () => {
    for (let count = MIN_DEMO_PARTIES; count <= MAX_DEMO_PARTIES; count++) {
      const parties = deriveDemoParties("run-1", count);
      expect(parties).toHaveLength(count);
      for (const party of parties) expect(isAddress(party.address)).toBe(true);
      expect(new Set(parties.map((p) => p.address)).size).toBe(count);
    }
  });

  it("is deterministic for a given run salt — re-derived, not random per call", () => {
    const a = deriveDemoParties("run-1", 3);
    const b = deriveDemoParties("run-1", 3);
    expect(a).toEqual(b);
    expect(privateKeyToAccount(a[0]!.privateKey).address).toBe(a[0]!.address);
  });

  it("gives different runs entirely different addresses", () => {
    const a = deriveDemoParties("run-1", 3);
    const b = deriveDemoParties("run-2", 3);
    expect(a[0]!.address).not.toBe(b[0]!.address);
  });

  it("uses the spec's named 3-node fixture labels only when count is exactly 3", () => {
    const three = deriveDemoParties("run-1", 3);
    expect(three.map((p) => p.label)).toEqual(["Northwind DSP", "Meridian Exchange", "Atlas Publisher"]);

    const four = deriveDemoParties("run-1", 4);
    expect(four.map((p) => p.label)).toEqual(["Party 1", "Party 2", "Party 3", "Party 4"]);
  });

  it("rejects a party count outside the real on-chain MIN/MAX_CYCLE_LENGTH bounds", () => {
    expect(() => deriveDemoParties("run-1", 2)).toThrow();
    expect(() => deriveDemoParties("run-1", 6)).toThrow();
  });
});
