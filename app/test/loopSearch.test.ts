import { describe, expect, it } from "vitest";
import { keccak256, toHex, type Address, type Hex } from "viem";
import {
  findBestLoop,
  isNettableNow,
  neighbourhoodEdges,
  neighbourhoodParties,
  SEARCH_MAX_VERTICES,
  type CandidateObligation,
} from "../src/obligations/loopSearch";

const NOW = 1_800_000_000n;
const party = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6].map(party) as [Address, Address, Address, Address, Address, Address];

let counter = 0;
function ob(debtor: Address, creditor: Address, remaining: bigint, extra: Partial<CandidateObligation> = {}): CandidateObligation {
  return {
    obligationId: keccak256(toHex(`obligation ${++counter}`)) as Hex,
    debtor,
    creditor,
    currency: "USD",
    remaining,
    maturity: NOW - 1n,
    earlyNetConsent: false,
    ...extra,
  };
}

const ids = (loop: CandidateObligation[]) => loop.map((o) => o.obligationId);

describe("isNettableNow", () => {
  it("needs something remaining, and maturity or consent to net early", () => {
    expect(isNettableNow(ob(A, B, 1n), NOW)).toBe(true);
    expect(isNettableNow(ob(A, B, 0n), NOW)).toBe(false);
    expect(isNettableNow(ob(A, B, 1n, { maturity: NOW + 1n }), NOW)).toBe(false);
    expect(isNettableNow(ob(A, B, 1n, { maturity: NOW + 1n, earlyNetConsent: true }), NOW)).toBe(true);
    expect(isNettableNow(ob(A, B, 1n, { maturity: NOW }), NOW)).toBe(true);
  });
});

describe("findBestLoop", () => {
  it("finds the loop through the caller", () => {
    const loop = [ob(A, B, 500n), ob(B, C, 300n), ob(C, A, 400n)];
    const result = findBestLoop(loop, A, { now: NOW });
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.wNet).toBe(300n);
    expect(new Set(ids(result.loop))).toEqual(new Set(ids(loop)));
    expect(result.currency).toBe("USD");
  });

  it("finds a two-party loop", () => {
    const result = findBestLoop([ob(A, B, 70n), ob(B, A, 90n)], B, { now: NOW });
    expect(result.kind === "found" && result.wNet).toBe(70n);
  });

  it("never proposes a loop the caller isn't in", () => {
    const others = [ob(B, C, 100n), ob(C, D, 100n), ob(D, B, 100n)];
    expect(findBestLoop(others, A, { now: NOW })).toEqual({ kind: "none" });
    expect(findBestLoop([...others, ob(A, E, 100n)], A, { now: NOW })).toEqual({ kind: "none" });
  });

  it("ignores a bigger loop nearby that doesn't include the caller", () => {
    // B→C→B sits inside A's neighbourhood and nets more, but A isn't in it.
    const nearby = [ob(A, B, 10n), ob(B, C, 900n), ob(C, A, 10n), ob(C, B, 900n)];
    const result = findBestLoop(nearby, A, { now: NOW });
    expect(result.kind === "found" && result.wNet).toBe(10n);
    expect(result.kind === "found" && result.loop.map((o) => o.debtor)).toContain(A);
  });

  it("picks the largest wNet among the caller's loops", () => {
    const small = [ob(A, B, 50n), ob(B, A, 50n)];
    const large = [ob(A, C, 900n), ob(C, D, 800n), ob(D, A, 700n)];
    const result = findBestLoop([...small, ...large], A, { now: NOW });
    expect(result.kind === "found" && result.wNet).toBe(700n);
    expect(result.kind === "found" && new Set(ids(result.loop))).toEqual(new Set(ids(large)));
  });

  it("never returns a loop that visits a party twice", () => {
    // A→B→A→C→A is a closed walk through A, but A appears twice.
    const walk = [ob(A, B, 100n), ob(B, A, 100n), ob(A, C, 100n), ob(C, A, 100n)];
    const result = findBestLoop(walk, A, { now: NOW });
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.loop).toHaveLength(2);
    expect(new Set(result.loop.map((o) => o.debtor)).size).toBe(2);
  });

  it("keeps currencies apart", () => {
    const mixed = [ob(A, B, 100n), ob(B, C, 100n, { currency: "GHS" }), ob(C, A, 100n)];
    expect(findBestLoop(mixed, A, { now: NOW })).toEqual({ kind: "none" });

    const two = [ob(A, B, 100n, { currency: "GHS" }), ob(B, A, 100n, { currency: "GHS" }), ob(A, C, 5n), ob(C, A, 5n)];
    const result = findBestLoop(two, A, { now: NOW });
    // Currencies are tried in code order, so GHS comes before USD.
    expect(result.kind === "found" && result.currency).toBe("GHS");
  });

  it("drops what isn't nettable and what involves an excluded party", () => {
    const loop = [ob(A, B, 100n), ob(B, C, 100n), ob(C, A, 100n)];
    expect(findBestLoop(loop, A, { now: NOW, excludedParties: new Set([C]) })).toEqual({ kind: "none" });

    const immature = [ob(A, B, 100n), ob(B, A, 100n, { maturity: NOW + 10n })];
    expect(findBestLoop(immature, A, { now: NOW })).toEqual({ kind: "none" });
    const consented = [ob(A, B, 100n), ob(B, A, 100n, { maturity: NOW + 10n, earlyNetConsent: true })];
    expect(findBestLoop(consented, A, { now: NOW }).kind).toBe("found");

    const settled = [ob(A, B, 100n), ob(B, A, 0n)];
    expect(findBestLoop(settled, A, { now: NOW })).toEqual({ kind: "none" });
  });

  it("isn't blocked by a large graph of unrelated parties", () => {
    const unrelated: CandidateObligation[] = [];
    for (let i = 100; i < 160; i++) unrelated.push(ob(party(i), party(i + 1), 10n));
    unrelated.push(ob(party(160), party(100), 10n));
    const mine = [ob(A, B, 40n), ob(B, A, 40n)];
    const result = findBestLoop([...unrelated, ...mine], A, { now: NOW });
    expect(result.kind === "found" && result.wNet).toBe(40n);
  });

  it("does not let unrelated inner cycles exhaust the caller's cycle budget", () => {
    const candidates = [ob(A, B, 100n)];
    for (let i = 0; i < 501; i++) {
      candidates.push(ob(B, C, 100n), ob(C, B, 100n));
    }
    candidates.push(ob(B, A, 100n));
    const result = findBestLoop(candidates, A, { now: NOW });
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.loop).toHaveLength(2);
      expect(result.loop.some((e) => e.debtor === A)).toBe(true);
    }
  });

  it("reports an incomplete search when the caller's cycle output cap is saturated", () => {
    const parties = Array.from({ length: 7 }, (_, i) => party(200 + i));
    const candidates: CandidateObligation[] = [];
    for (const debtor of parties) {
      for (const creditor of parties) {
        if (debtor !== creditor) candidates.push(ob(debtor, creditor, 10n));
      }
    }
    expect(findBestLoop(candidates, parties[0]!, { now: NOW })).toEqual({
      kind: "search-incomplete",
      currency: "USD",
      maxCycles: 500,
    });
  });

  it("fails closed when the caller's own neighbourhood is over the cap", () => {
    // A owes 40 parties, each of whom owes A back: 41 parties, all within reach.
    const crowd: CandidateObligation[] = [];
    for (let i = 100; i < 140; i++) crowd.push(ob(A, party(i), 10n), ob(party(i), A, 10n));
    const result = findBestLoop(crowd, A, { now: NOW });
    expect(result).toEqual({ kind: "too-many-parties", currency: "USD", parties: 41 });
    expect(41).toBeGreaterThan(SEARCH_MAX_VERTICES);
  });
});

describe("neighbourhood", () => {
  it("keeps exactly the obligations that fit on a loop of at most 5 through the caller", () => {
    const ring5 = [ob(A, B, 1n), ob(B, C, 1n), ob(C, D, 1n), ob(D, E, 1n), ob(E, A, 1n)];
    expect(neighbourhoodEdges(ring5, A)).toHaveLength(5);

    const ring6 = [ob(A, B, 1n), ob(B, C, 1n), ob(C, D, 1n), ob(D, E, 1n), ob(E, F, 1n), ob(F, A, 1n)];
    expect(neighbourhoodEdges(ring6, A)).toHaveLength(0);

    const dangling = ob(B, F, 1n);
    expect(neighbourhoodEdges([...ring5, dangling], A)).not.toContain(dangling);
  });

  it("lists the parties to screen, only among what could be netted", () => {
    const parties = neighbourhoodParties(
      [ob(A, B, 1n), ob(B, A, 1n), ob(C, D, 1n), ob(D, C, 1n), ob(A, E, 1n, { maturity: NOW + 5n }), ob(E, A, 1n)],
      A,
      NOW,
    );
    expect(parties).toEqual(new Set([A, B]));
  });
});
