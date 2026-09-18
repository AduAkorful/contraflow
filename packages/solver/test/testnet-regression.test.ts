import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { proposeSettleCall } from "../src/propose.js";
import type { InvoiceEdge, Address, InvoiceId } from "../src/types.js";

/**
 * Regression test against a real, static snapshot of actual invoices registered and settled on
 * live Arc testnet (plans/03-live-testnet-e2e-tests.md SET-01) -- not a synthetic graph. Proves
 * the solver agrees with what ContraflowSettler.settle() already accepted for real, independent
 * of any assumption baked into the synthetic test cases elsewhere in this suite. The fixture is
 * a static JSON capture (see test/fixtures/testnet-live-cycles.json's header comment) -- this
 * test performs no network calls itself, keeping the suite hermetic.
 */
const fixturePath = fileURLToPath(new URL("./fixtures/testnet-live-cycles.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
  invoices: { id: string; debtor: string; creditor: string; amountRemaining: string }[];
  expectedWNet: string;
};

describe("testnet regression fixture (real captured live data)", () => {
  it("proposes exactly the cycle and wNet the live ContraflowSettler.settle() already used successfully", () => {
    const invoices: InvoiceEdge[] = fixture.invoices.map((inv) => ({
      id: inv.id as InvoiceId,
      debtor: inv.debtor as Address,
      creditor: inv.creditor as Address,
      amountRemaining: BigInt(inv.amountRemaining),
    }));

    const call = proposeSettleCall(invoices);

    expect(call).not.toBeNull();
    expect(call!.wNet).toBe(BigInt(fixture.expectedWNet));
    expect(new Set(call!.invoiceIds)).toEqual(new Set(fixture.invoices.map((i) => i.id)));
  });
});
