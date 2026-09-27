import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { addressSignals, cycleSignals, isContraflowOnly, type AddressActivity, type KnownAddresses } from "../src/inspector/signals";
import {
  describeCycle,
  describeFirstFunder,
  describeFirstSeen,
  describeOutsideActivity,
  formatDuration,
} from "../src/inspector/format";
import type { AddressTokenTransfer, AddressTransaction } from "../src/blockscout/client";

const KNOWN: KnownAddresses = {
  registry: "0x1111111111111111111111111111111111111111",
  settler: "0x2222222222222222222222222222222222222222",
  usdc: "0x3600000000000000000000000000000000000000",
  operator: "0x0Bb0000000000000000000000000000000000000",
};
const ZERO = "0x0000000000000000000000000000000000000000";
const PARTY = "0xAaAa000000000000000000000000000000000001";
const FUNDER = "0xFfFf000000000000000000000000000000000009";
const OTHER = "0xCcCc000000000000000000000000000000000003";
const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

function tx(timestamp: string, from: string, to: string | null): AddressTransaction {
  return { hash: `0x${timestamp}`, timestamp, from, to };
}

function transfer(timestamp: string, from: string, to: string, token = KNOWN.usdc): AddressTokenTransfer {
  return { transactionHash: `0x${timestamp}`, timestamp, from, to, token };
}

function activity(overrides: Partial<AddressActivity> = {}): AddressActivity {
  return {
    address: PARTY,
    isContract: false,
    transactions: { items: [], truncated: false },
    transfers: { items: [], truncated: false },
    firstInvoiceAt: null,
    ...overrides,
  };
}

describe("addressSignals — first seen", () => {
  it("takes the earliest timestamp across transactions and transfers", () => {
    const s = addressSignals(
      activity({
        transactions: { items: [tx("2026-09-20T00:00:00Z", PARTY, KNOWN.registry)], truncated: false },
        transfers: { items: [transfer("2026-09-18T00:00:00Z", FUNDER, PARTY)], truncated: false },
      }),
      KNOWN,
    );
    expect(s.firstSeen).toEqual({ kind: "exact", at: "2026-09-18T00:00:00Z" });
  });

  it("becomes a lower bound when either list was truncated", () => {
    const s = addressSignals(
      activity({ transactions: { items: [tx("2026-09-20T00:00:00Z", PARTY, OTHER)], truncated: true } }),
      KNOWN,
    );
    expect(s.firstSeen.kind).toBe("onOrBefore");
    expect(describeFirstSeen(s)).toBe("On or before 20 Sept 2026");
  });

  it("falls back to the first invoice appearance for a sign-only party", () => {
    const s = addressSignals(activity({ firstInvoiceAt: "2026-09-21T10:00:00Z" }), KNOWN);
    expect(s.firstSeen).toEqual({ kind: "invoiceOnly", at: "2026-09-21T10:00:00Z" });
    expect(describeFirstSeen(s)).toContain("First named in a Contraflow invoice on 21 Sept 2026");
  });

  it("reports no activity at all honestly", () => {
    expect(addressSignals(activity(), KNOWN).firstSeen).toEqual({ kind: "never" });
  });
});

describe("addressSignals — activity outside Contraflow", () => {
  it("excludes registry and settler calls and operator funding", () => {
    const s = addressSignals(
      activity({
        transactions: {
          items: [
            tx("2026-09-22T00:00:00Z", PARTY, OTHER),
            tx("2026-09-21T00:00:00Z", PARTY, KNOWN.settler),
            tx("2026-09-20T00:00:00Z", PARTY, KNOWN.registry),
            tx("2026-09-19T00:00:00Z", KNOWN.operator!, PARTY),
          ],
          truncated: false,
        },
      }),
      KNOWN,
    );
    expect(s.outsideActivity).toEqual({ count: 1, lowerBound: false });
    expect(isContraflowOnly(s)).toBe(false);
  });

  it("never calls a truncated history Contraflow-only", () => {
    const s = addressSignals(
      activity({ transactions: { items: [tx("2026-09-20T00:00:00Z", PARTY, KNOWN.registry)], truncated: true } }),
      KNOWN,
    );
    expect(isContraflowOnly(s)).toBe(false);
    expect(describeOutsideActivity(s)).toBe("None in its latest 200 transactions");
  });

  it("phrases a truncated non-zero count as a minimum", () => {
    const s = addressSignals(
      activity({ transactions: { items: [tx("2026-09-20T00:00:00Z", PARTY, OTHER)], truncated: true } }),
      KNOWN,
    );
    expect(describeOutsideActivity(s)).toBe("At least 1");
  });
});

describe("addressSignals — first funder", () => {
  it("labels operator funding as the operator wallet and skips it for matching", () => {
    const s = addressSignals(
      activity({
        transfers: {
          items: [transfer("2026-09-21T00:00:00Z", FUNDER, PARTY), transfer("2026-09-20T00:00:00Z", KNOWN.operator!, PARTY)],
          truncated: false,
        },
      }),
      KNOWN,
    );
    expect(s.firstFunder).toEqual({ kind: "operator" });
    expect(describeFirstFunder(s)).toBe("Contraflow's operator wallet, which sends the starter grant");
    expect(s.matchingFunder).toBe(FUNDER.toLowerCase());
  });

  it("treats a zero-address mint as bridged-in funding, never as a shared funder", () => {
    const s = addressSignals(activity({ transfers: { items: [transfer("2026-09-20T00:00:00Z", ZERO, PARTY)], truncated: false } }), KNOWN);
    expect(s.firstFunder).toEqual({ kind: "mint" });
    expect(s.matchingFunder).toBeNull();
  });

  it("ignores outgoing transfers and non-USDC tokens", () => {
    const s = addressSignals(
      activity({
        transfers: {
          items: [transfer("2026-09-21T00:00:00Z", OTHER, PARTY, EURC), transfer("2026-09-20T00:00:00Z", PARTY, OTHER)],
          truncated: false,
        },
      }),
      KNOWN,
    );
    expect(s.firstFunder).toEqual({ kind: "none" });
  });

  it("keeps on-chain order for same-second transfers", () => {
    // Newest-first input, both in the same second: OTHER's transfer is older on-chain.
    const s = addressSignals(
      activity({
        transfers: {
          items: [transfer("2026-09-20T00:00:00Z", FUNDER, PARTY), transfer("2026-09-20T00:00:00Z", OTHER, PARTY)],
          truncated: false,
        },
      }),
      KNOWN,
    );
    expect(s.firstFunder).toEqual({ kind: "address", address: OTHER });
  });

  it("shows raw funder addresses when the operator key isn't configured", () => {
    const s = addressSignals(
      activity({ transfers: { items: [transfer("2026-09-20T00:00:00Z", KNOWN.operator!, PARTY)], truncated: false } }),
      { ...KNOWN, operator: null },
    );
    expect(s.firstFunder).toEqual({ kind: "address", address: KNOWN.operator });
  });

  it("marks the funder as the earliest found when transfers were truncated", () => {
    const s = addressSignals(activity({ transfers: { items: [transfer("2026-09-20T00:00:00Z", FUNDER, PARTY)], truncated: true } }), KNOWN);
    expect(describeFirstFunder(s)).toContain("earliest in its latest 200 transfers");
  });
});

describe("cycleSignals", () => {
  function party(address: string, firstSeenAt: string, funder: string | null, outside = 0) {
    return addressSignals(
      {
        address,
        isContract: false,
        transactions: {
          items: outside > 0 ? [tx(firstSeenAt, address, OTHER)] : [tx(firstSeenAt, address, KNOWN.registry)],
          truncated: false,
        },
        transfers: { items: funder ? [transfer(firstSeenAt, funder, address)] : [], truncated: false },
        firstInvoiceAt: null,
      },
      KNOWN,
    );
  }

  it("detects a shared third-party funder across the cycle", () => {
    const parties = [
      party("0xA000000000000000000000000000000000000001", "2026-09-20T00:00:00Z", FUNDER),
      party("0xA000000000000000000000000000000000000002", "2026-09-20T00:03:00Z", FUNDER),
      party("0xA000000000000000000000000000000000000003", "2026-09-20T00:05:00Z", FUNDER),
    ];
    const c = cycleSignals(parties, 3, "2026-09-20T01:00:00Z", "2026-09-20T01:12:00Z");
    expect(c.sharedFunder).toEqual({ address: FUNDER.toLowerCase(), count: 3 });
    expect(c.firstSeenSpread).toEqual({ ms: 5 * 60_000, approximate: false });
    expect(c.contraflowOnlyCount).toBe(3);
    expect(c.registerToSettleMs).toBe(12 * 60_000);

    const facts = describeCycle(c);
    expect(facts.map((f) => f.value)).toEqual([
      "Within 5 minutes of each other",
      `3 of 3 parties were first funded by ${getAddress(FUNDER).slice(0, 6)}…0009`,
      "3 of 3 parties",
      "12 minutes",
    ]);
  });

  it("does not report a shared funder when every party was operator- or mint-funded", () => {
    const parties = [
      party("0xA000000000000000000000000000000000000001", "2026-09-20T00:00:00Z", KNOWN.operator),
      party("0xA000000000000000000000000000000000000002", "2026-09-20T00:00:00Z", KNOWN.operator),
      party("0xA000000000000000000000000000000000000003", "2026-09-20T00:00:00Z", ZERO),
    ];
    expect(cycleSignals(parties, 3, null, null).sharedFunder).toBeNull();
  });

  it("does not report a shared funder with mixed funders", () => {
    const parties = [
      party("0xA000000000000000000000000000000000000001", "2026-09-20T00:00:00Z", FUNDER),
      party("0xA000000000000000000000000000000000000002", "2026-09-20T00:00:00Z", OTHER),
      party("0xA000000000000000000000000000000000000003", "2026-09-20T00:00:00Z", null, 2),
    ];
    const c = cycleSignals(parties, 3, null, null);
    expect(c.sharedFunder).toBeNull();
    expect(c.contraflowOnlyCount).toBe(2);
    expect(c.registerToSettleMs).toBeNull();
  });

  it("marks the first-seen spread approximate when a party's time isn't exact", () => {
    const signOnly = addressSignals(activity({ address: OTHER, firstInvoiceAt: "2026-09-22T00:00:00Z" }), KNOWN);
    const c = cycleSignals([party(PARTY, "2026-09-20T00:00:00Z", FUNDER), signOnly], 2, null, null);
    expect(c.firstSeenSpread).toEqual({ ms: 2 * 86_400_000, approximate: true });
    expect(describeCycle(c)[0]?.value).toBe("Within about 2 days of each other");
  });

  it("says 'a minute' rather than 'under a minute' inside the spread sentence", () => {
    const c = cycleSignals(
      [party(PARTY, "2026-09-20T00:00:00Z", FUNDER), party(OTHER, "2026-09-20T00:00:20Z", OTHER)],
      2,
      null,
      null,
    );
    expect(describeCycle(c)[0]?.value).toBe("Within a minute of each other");
  });

  it("omits the spread when fewer than two parties have a first-seen time", () => {
    const c = cycleSignals([party(PARTY, "2026-09-20T00:00:00Z", FUNDER), addressSignals(activity({ address: OTHER }), KNOWN)], 2, null, null);
    expect(c.firstSeenSpread).toBeNull();
  });
});

describe("formatDuration", () => {
  it("picks a readable unit", () => {
    expect(formatDuration(30_000)).toBe("under a minute");
    expect(formatDuration(60_000)).toBe("1 minute");
    expect(formatDuration(3 * 3_600_000)).toBe("3 hours");
    expect(formatDuration(45 * 86_400_000)).toBe("2 months");
    expect(formatDuration(800 * 86_400_000)).toBe("2 years");
  });
});
