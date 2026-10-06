import { describe, expect, it } from "vitest";
import sample from "../src/app/app/verify/sample-certificate.json";
import { parseCertificateView } from "../src/netting/serialize";
import { verifyCertificateView } from "../src/netting/verify";

describe("sample certificate", () => {
  it("passes the signed-stage checks without a chain client", async () => {
    const view = parseCertificateView(JSON.stringify(sample));
    const result = await verifyCertificateView(view, { now: 1_800_000_000n, stage: "signed" });
    expect(result.ok).toBe(true);
    expect(result.checks.some((check) => check.name.startsWith("onchain"))).toBe(false);
  });
});
