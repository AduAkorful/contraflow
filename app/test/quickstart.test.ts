import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";

const source = readFileSync(join(__dirname, "../public/contraflow-quickstart.mjs"), "utf8");

describe("quick-start script", () => {
  it("derives the same document hash as the published vectors", () => {
    const body = /function documentHash\(doc\) \{([\s\S]*?)\n\}\n/.exec(source)?.[1];
    expect(body).toBeTruthy();
    const documentHash = new Function("keccak256", "toHex", "doc", body!) as (k: unknown, t: unknown, d: unknown) => string;
    const hash = documentHash(keccak256, toHex, {
      format: "contraflow-obligation/1",
      description: "INV-1042: consulting, September 2026",
      debtor: "0xe05fcc23807536bee418f142d19fa0d21bb0cff7",
      creditor: "0x0376aac07ad725e01357b1725b5cec61ae10473c",
      currency: "USD",
      amount: "1250.00",
      maturity: "2026-10-31",
      earlyNetConsent: true,
    });
    expect(hash).toBe("0xb59a4a60e4c91912945825b3e037b0034d71f899eeab1247967e9e3a423208ff");
  });

  it("reads keys from the environment and holds none", () => {
    expect(source).toMatch(/process\.env\.CONTRAFLOW_API_KEY/);
    expect(source).toMatch(/process\.env\.PAYER_PRIVATE_KEY/);
    expect(source).not.toMatch(/cfk_test_[A-Za-z0-9_-]{8,}/);
    expect(source).not.toMatch(/0x[0-9a-fA-F]{64}\b/);
  });

  it("only uses endpoints the API serves", async () => {
    const { OPENAPI } = await import("../src/api/openapi");
    const paths = Object.keys(OPENAPI.paths);
    for (const used of ["/tenant", "/permissions/typed-data", "/permissions", "/obligations/proposals", "/obligations/proposals/{token}/accept", "/parties/{address}/loops", "/certificates/{token}", "/certificates/{token}/signatures", "/certificates/{token}/apply-transaction", "/certificates/{token}/transactions", "/parties/{address}/obligations"]) {
      expect(paths, used).toContain(used);
    }
  });
});
