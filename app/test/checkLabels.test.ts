import { describe, expect, it } from "vitest";
import { isCheckLabelled, verificationPassedHeadline } from "../components/netting/checks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERIFIER_SOURCE = readFileSync(resolve(__dirname, "../src/netting/verify.ts"), "utf8");
const PARTY_SOURCE = readFileSync(resolve(__dirname, "../components/netting/partyChecks.ts"), "utf8");

function namesFrom(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/add\(\s*"([^"]+)"/g)) names.add(match[1]!);
  for (const match of source.matchAll(/name:\s*"([^"]+)"/g)) names.add(match[1]!);
  return [...names];
}

const PATTERN_SAMPLES = [
  "certificate-signature:0",
  "onchain:entry:0:state",
  "entry:0:obligation-id",
  "entry:0:parties",
  "entry:0:obligation-signatures",
  "entry:0:currency",
  "entry:0:prior-commitment",
  "entry:0:amounts",
  "entry:0:next-commitment",
  "entry:0:maturity",
];

describe("verifier check labels", () => {
  it("labels every name the verifier and party checks emit", () => {
    const names = [...namesFrom(VERIFIER_SOURCE), ...namesFrom(PARTY_SOURCE), ...PATTERN_SAMPLES];
    expect(names.length).toBeGreaterThan(8);
    const unlabelled = names.filter((name) => !isCheckLabelled(name));
    expect(unlabelled).toEqual([]);
  });
});

describe("verification headline", () => {
  it("states partial coverage when some entries are hashes-only", () => {
    expect(verificationPassedHeadline(5, 5)).toBe("Every check passed.");
    expect(verificationPassedHeadline(2, 5)).toBe(
      "Every check passed. Full detail for the 2 obligations you're party to; the other 3 are covered by the signatures in the file.",
    );
  });
});
