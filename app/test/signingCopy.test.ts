import { describe, expect, it } from "vitest";
import {
  certificateSigningConfirmation,
  earlyNettingHelper,
  invoiceSigningConfirmation,
  obligationSigningConfirmation,
  typedDataUiRoute,
} from "../src/format/signing";

describe("early netting helper", () => {
  it("states the consequence for on and off against the chosen date", () => {
    expect(earlyNettingHelper("2026-11-05", true)).toBe("On: this can join a loop before its due date.");
    expect(earlyNettingHelper("2026-11-05", false)).toBe("Off: it can't be netted until 5 November 2026.");
  });
});

describe("signing confirmation", () => {
  it("prints minor units as a currency amount and unix time as a date", () => {
    expect(
      obligationSigningConfirmation({
        youOwe: true,
        amountMinor: "1000",
        currency: "USD",
        counterparty: "0x1111111111111111111111111111111111111111",
        maturity: "1798675200",
        earlyNetConsent: false,
      }),
    ).toMatch(/You're confirming: you owe \$10\.00 to 0x1111…1111, due 31 December 2026\. Early netting: off\./);
  });

  it("prints an invoice confirmation in USDC", () => {
    const text = invoiceSigningConfirmation({
      youOwe: true,
      amountUsdc: 10_000_000n,
      counterparty: "0x2222222222222222222222222222222222222222",
      maturity: 1798675200n,
      earlyNetConsent: true,
    });
    expect(text).toContain("you owe");
    expect(text).toContain("10.00 USDC");
    expect(text).toContain("Early netting: on");
  });

  it("prints a certificate confirmation without raw field names", () => {
    expect(certificateSigningConfirmation({ wNet: "1000", currency: "USD", parties: 3 })).toContain(
      "this nets $10.00 off each of 3 obligations",
    );
  });
});

describe("typed-data UI route", () => {
  it("sends embedded wallets through Privy and others through wagmi", () => {
    expect(typedDataUiRoute("privy")).toBe("privy");
    expect(typedDataUiRoute("metamask")).toBe("wagmi");
  });
});
