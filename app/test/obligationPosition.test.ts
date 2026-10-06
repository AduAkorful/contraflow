import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  obligationPositionByCurrency,
  obligationPositionLine,
  obligationStatusLabel,
} from "../src/obligations/position";
import type { ObligationSummary } from "../src/obligations/service";

const A = "0x1111111111111111111111111111111111111111" as Address;

function row(partial: Partial<ObligationSummary> & Pick<ObligationSummary, "currency" | "remaining" | "youOwe">): ObligationSummary {
  return {
    obligationId: partial.obligationId ?? "id",
    counterparty: A,
    amount: partial.amount ?? partial.remaining,
    maturity: "1798675200",
    description: "x",
    status: partial.status ?? "active",
    earlyNetConsent: true,
    ...partial,
  };
}

describe("obligation position", () => {
  it("sums remaining per currency and direction, ignoring closed rows", () => {
    const positions = obligationPositionByCurrency([
      row({ currency: "GHS", remaining: "50000", youOwe: true }),
      row({ currency: "GHS", remaining: "25000", youOwe: false }),
      row({ currency: "USD", remaining: "1000", youOwe: true }),
      row({ currency: "GHS", remaining: "99999", youOwe: true, status: "closed" }),
      row({ currency: "GHS", remaining: "1000", youOwe: false, status: "out_of_sync" }),
    ]);
    expect(positions).toEqual([
      { currency: "GHS", youOwe: 50000n, owedToYou: 25000n },
      { currency: "USD", youOwe: 1000n, owedToYou: 0n },
    ]);
  });

  it("formats a net-negative GHS position", () => {
    const line = obligationPositionLine({ currency: "USD", youOwe: 50000n, owedToYou: 25000n });
    expect(line).toContain("You owe");
    expect(line).toContain("You're owed");
    expect(line).toMatch(/Net −/);
  });
});

describe("obligation status label", () => {
  it("maps active, partly netted and closed", () => {
    expect(obligationStatusLabel({ status: "active", remaining: "50000", amount: "50000", currency: "USD" })).toBe(
      "Active · can be netted",
    );
    expect(obligationStatusLabel({ status: "active", remaining: "35000", amount: "50000", currency: "USD" })).toMatch(
      /^Netted · .+ remaining$/,
    );
    expect(obligationStatusLabel({ status: "closed", remaining: "0", amount: "50000", currency: "USD" })).toBe("Closed");
  });
});
