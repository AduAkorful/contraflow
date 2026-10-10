import { describe, expect, it } from "vitest";
import { numberToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBlinding } from "../src/netting/commitment";
import {
  buildObligationDocument,
  canonicalizeObligationDocument,
  hashObligationDocument,
  maturityDateToUnixSeconds,
  obligationDocumentProblem,
  obligationFromDocument,
  obligationMatchesDocument,
  OBLIGATION_DOCUMENT_FORMAT,
  type CanonicalObligationDocument,
} from "../src/netting/document";
import { isShareToken, newShareToken } from "../src/share/shareToken";

// The same keys as the Solidity known vectors (0xA11CE, 0xB0B).
const alice = privateKeyToAccount(numberToHex(0xa11ce, { size: 32 })).address;
const bob = privateKeyToAccount(numberToHex(0xb0b, { size: 32 })).address;

const DOC: CanonicalObligationDocument = {
  format: OBLIGATION_DOCUMENT_FORMAT,
  description: "INV-1042: consulting, September 2026",
  debtor: alice,
  creditor: bob,
  currency: "USD",
  amount: "1250.00",
  maturity: "2026-10-31",
  earlyNetConsent: true,
};

describe("canonical obligation document", () => {
  it("doesn't depend on key order, description whitespace or address case", () => {
    const reordered = {
      earlyNetConsent: DOC.earlyNetConsent,
      maturity: DOC.maturity,
      amount: DOC.amount,
      currency: DOC.currency,
      creditor: DOC.creditor.toLowerCase() as `0x${string}`,
      debtor: DOC.debtor.toUpperCase().replace("0X", "0x") as `0x${string}`,
      description: `  ${DOC.description}\n`,
      format: DOC.format,
    };
    expect(canonicalizeObligationDocument(reordered)).toBe(canonicalizeObligationDocument(DOC));
    expect(hashObligationDocument(reordered)).toBe(hashObligationDocument(DOC));
  });

  it("carries the format tag and every term", () => {
    const canonical = canonicalizeObligationDocument(DOC);
    expect(canonical).toContain(`"format":"${OBLIGATION_DOCUMENT_FORMAT}"`);
    for (const change of [
      { amount: "1250.01" },
      { currency: "EUR" },
      { maturity: "2026-11-01" },
      { earlyNetConsent: false },
      { description: "INV-1043" },
    ]) {
      expect(hashObligationDocument({ ...DOC, ...change })).not.toBe(hashObligationDocument(DOC));
    }
  });

  it("has a fixed hash, so any change to canonicalization is caught", () => {
    expect(canonicalizeObligationDocument(DOC)).toBe(
      '{"amount":"1250.00","creditor":"0x0376aac07ad725e01357b1725b5cec61ae10473c","currency":"USD","debtor":"0xe05fcc23807536bee418f142d19fa0d21bb0cff7","description":"INV-1042: consulting, September 2026","earlyNetConsent":true,"format":"contraflow-obligation/1","maturity":"2026-10-31"}',
    );
    // Computed independently: `cast keccak '<the canonical string above>'`.
    expect(hashObligationDocument(DOC)).toBe("0xb59a4a60e4c91912945825b3e037b0034d71f899eeab1247967e9e3a423208ff");
  });

  it("publishes three fixed hashes tenants can recompute (USD, EUR, JPY)", () => {
    const freight = buildObligationDocument({
      description: "Freight invoice 88",
      debtor: alice,
      creditor: bob,
      currency: "EUR",
      amount: "100.00",
      maturity: "2027-01-15",
      earlyNetConsent: false,
    });
    const yen = buildObligationDocument({
      description: "Yen retainer",
      debtor: alice,
      creditor: bob,
      currency: "JPY",
      amount: "25000",
      maturity: "2026-12-01",
      earlyNetConsent: true,
    });
    expect(hashObligationDocument(DOC)).toBe("0xb59a4a60e4c91912945825b3e037b0034d71f899eeab1247967e9e3a423208ff");
    expect(hashObligationDocument(freight)).toBe("0xee54b80d177f5ae0950334b743022ebc67f677c2375d7913d8a8d2e639814da4");
    expect(hashObligationDocument(yen)).toBe("0x074efe5c0950a65575be0fe7082ef13ed953b34bb612961d74d16f1d95c89571");
  });
});

describe("maturity dates", () => {
  it("converts to midnight UTC", () => {
    expect(maturityDateToUnixSeconds("2026-10-31")).toBe(BigInt(Date.UTC(2026, 9, 31) / 1000));
  });
  it("rejects anything that isn't a real date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "26-10-31", "2026-10-31T00:00:00Z", ""]) {
      expect(() => maturityDateToUnixSeconds(bad), bad).toThrow();
    }
  });
});

describe("obligationDocumentProblem", () => {
  it("accepts a valid document", () => {
    expect(obligationDocumentProblem(DOC)).toBeNull();
  });
  it("names each problem", () => {
    const cases: [Partial<CanonicalObligationDocument>, RegExp][] = [
      [{ description: "   " }, /description/i],
      [{ description: "x".repeat(501) }, /500/],
      [{ creditor: DOC.debtor }, /different/],
      [{ debtor: "0x0000000000000000000000000000000000000000" }, /address/i],
      [{ currency: "usd" }, /ISO 4217/],
      [{ amount: "0.00" }, /more than zero/],
      [{ amount: "12.345" }, /decimal/],
      [{ maturity: "2026-02-30" }, /maturity/i],
      [{ format: "contraflow-obligation/2" as typeof OBLIGATION_DOCUMENT_FORMAT }, /format/i],
    ];
    for (const [change, pattern] of cases) {
      expect(obligationDocumentProblem({ ...DOC, ...change }), JSON.stringify(change)).toMatch(pattern);
    }
  });
});

describe("obligationFromDocument / obligationMatchesDocument", () => {
  it("builds the obligation the document describes, and detects any disagreement", () => {
    const salt = randomBlinding();
    const obligation = obligationFromDocument(DOC, salt);
    expect(obligation.amount).toBe(125_000n);
    expect(obligation.documentHash).toBe(hashObligationDocument(DOC));
    expect(obligationMatchesDocument(obligation, DOC)).toBe(true);

    for (const change of [
      { amount: 125_001n },
      { currency: "EUR" },
      { maturity: obligation.maturity + 1n },
      { earlyNetConsent: false },
      { debtor: DOC.creditor, creditor: DOC.debtor },
      { documentHash: hashObligationDocument({ ...DOC, description: "other" }) },
    ]) {
      expect(obligationMatchesDocument({ ...obligation, ...change }, DOC), JSON.stringify(change, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(false);
    }
  });
});

describe("proposal tokens", () => {
  it("are 22 URL-safe characters and distinct", () => {
    const tokens = new Set(Array.from({ length: 200 }, newShareToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isShareToken(token)).toBe(true);
    }
  });
  it("rejects anything else", () => {
    for (const bad of ["", "short", "a".repeat(23), "abc/def+ghi=jklmnopqrs", 42, null]) {
      expect(isShareToken(bad)).toBe(false);
    }
  });
});
