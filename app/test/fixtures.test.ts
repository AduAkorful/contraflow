import { describe, expect, it } from "vitest";
import { buildFixtureAttestations, type FixtureRoleAddresses } from "../src/fixtures/ads";

const ROLES: FixtureRoleAddresses = {
  northwind: "0x1000000000000000000000000000000000000001",
  meridian: "0x2000000000000000000000000000000000000002",
  atlas: "0x3000000000000000000000000000000000000003",
};

const BASE_PARAMS = {
  roles: ROLES,
  currency: "0x3600000000000000000000000000000000000000" as const,
  registry: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312" as const,
  chainId: 5042002n,
  nowUnixSeconds: 1_000_000_000n,
};

describe("buildFixtureAttestations", () => {
  it("builds the closed 3-cycle Northwind -> Meridian -> Atlas -> Northwind", () => {
    const fixtures = buildFixtureAttestations({
      ...BASE_PARAMS,
      nextNonces: { "northwind->meridian": 1n, "meridian->atlas": 1n, "atlas->northwind": 1n },
    });

    expect(fixtures).toHaveLength(3);
    expect(fixtures[0]?.attestation.debtor).toBe(ROLES.northwind);
    expect(fixtures[0]?.attestation.creditor).toBe(ROLES.meridian);
    expect(fixtures[1]?.attestation.debtor).toBe(ROLES.meridian);
    expect(fixtures[1]?.attestation.creditor).toBe(ROLES.atlas);
    expect(fixtures[2]?.attestation.debtor).toBe(ROLES.atlas);
    expect(fixtures[2]?.attestation.creditor).toBe(ROLES.northwind);

    // A closed cycle: each edge's creditor is the next edge's debtor, wrapping.
    for (let i = 0; i < fixtures.length; i++) {
      const next = fixtures[(i + 1) % fixtures.length];
      expect(fixtures[i]?.attestation.creditor).toBe(next?.attestation.debtor);
    }
  });

  it("sets earlyNetConsent = true on every invoice so the demo can settle immediately", () => {
    const fixtures = buildFixtureAttestations({
      ...BASE_PARAMS,
      nextNonces: { "northwind->meridian": 1n, "meridian->atlas": 1n, "atlas->northwind": 1n },
    });
    for (const f of fixtures) expect(f.attestation.earlyNetConsent).toBe(true);
  });

  it("uses the exact nonce supplied per (debtor, creditor) pair", () => {
    const fixtures = buildFixtureAttestations({
      ...BASE_PARAMS,
      nextNonces: { "northwind->meridian": 5n, "meridian->atlas": 12n, "atlas->northwind": 1n },
    });
    expect(fixtures[0]?.attestation.nonce).toBe(5n);
    expect(fixtures[1]?.attestation.nonce).toBe(12n);
    expect(fixtures[2]?.attestation.nonce).toBe(1n);
  });

  it("throws when a required pair is missing from nextNonces", () => {
    expect(() =>
      buildFixtureAttestations({ ...BASE_PARAMS, nextNonces: { "northwind->meridian": 1n } }),
    ).toThrow(/meridian->atlas/);
  });

  it("stamps every invoice with the given currency, registry, and chainId", () => {
    const fixtures = buildFixtureAttestations({
      ...BASE_PARAMS,
      nextNonces: { "northwind->meridian": 1n, "meridian->atlas": 1n, "atlas->northwind": 1n },
    });
    for (const f of fixtures) {
      expect(f.attestation.currency).toBe(BASE_PARAMS.currency);
      expect(f.attestation.registry).toBe(BASE_PARAMS.registry);
      expect(f.attestation.chainId).toBe(BASE_PARAMS.chainId);
    }
  });
});
