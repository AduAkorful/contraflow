import { describe, expect, it, vi } from "vitest";
import type { SwapEstimate } from "@circle-fin/app-kit";

import { quoteCacheKey, quoteRemainingInEurc, swapQuoteSupported, type QuoteDeps } from "../src/kits/quote";
import { eurcQuoteEnabled, formatQuoteTime, roundDecimalString, type EurcQuote } from "../src/kits/quoteFormat";
import { InvoiceStatus, type OnchainInvoice } from "../src/chain/readInvoices";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";

const ID = `0x${"ab".repeat(32)}` as const;
const PARTY_A = `0x${"11".repeat(20)}` as const;
const PARTY_B = `0x${"22".repeat(20)}` as const;
const NOW = new Date("2026-09-26T14:05:30Z");

function invoice(overrides: Partial<OnchainInvoice> = {}): OnchainInvoice {
  return {
    debtor: PARTY_A,
    creditor: PARTY_B,
    maturity: 0n,
    earlyNetConsent: true,
    status: InvoiceStatus.Active,
    amountRemaining: 12_345_000n,
    nonce: 1n,
    ...overrides,
  };
}

function estimate(amountIn: string, out = "10.146739", token = "EURC"): SwapEstimate {
  return { amountIn, estimatedOutput: { token, amount: out } } as unknown as SwapEstimate;
}

function deps(overrides: Partial<QuoteDeps> = {}): QuoteDeps & { cache: Map<string, EurcQuote> } {
  const cache = new Map<string, EurcQuote>();
  return {
    cache,
    chainId: ARC_TESTNET_CHAIN_ID,
    chainLabel: "Arc Testnet",
    readInvoice: vi.fn(async () => invoice()),
    estimate: vi.fn(async (amount: string) => estimate(amount)),
    rateLimit: vi.fn(async () => true),
    cacheGet: vi.fn(async (key: string) => cache.get(key) ?? null),
    cacheSet: vi.fn(async (key: string, value: EurcQuote) => {
      cache.set(key, value);
    }),
    now: () => NOW,
    ...overrides,
  };
}

describe("quoteRemainingInEurc", () => {
  it("quotes the Registry's live amountRemaining, not anything from the caller", async () => {
    const d = deps();
    const result = await quoteRemainingInEurc(ID, d);

    expect(d.readInvoice).toHaveBeenCalledWith(ID);
    expect(d.estimate).toHaveBeenCalledWith("12.345");
    expect(result).toEqual({
      ok: true,
      quote: { amountInUsdc: "12.345", estimatedOutputEurc: "10.146739", chainLabel: "Arc Testnet", quotedAt: NOW.toISOString() },
    });
  });

  it("rejects a malformed invoice id before touching the limiter, chain or Circle", async () => {
    const d = deps();
    expect(await quoteRemainingInEurc("12.345", d)).toEqual({ ok: false, reason: "not_found" });
    expect(d.rateLimit).not.toHaveBeenCalled();
    expect(d.readInvoice).not.toHaveBeenCalled();
    expect(d.estimate).not.toHaveBeenCalled();
  });

  it("fails closed when the rate limiter is unreachable", async () => {
    const d = deps({ rateLimit: vi.fn(async () => Promise.reject(new Error("upstash down"))) });
    expect(await quoteRemainingInEurc(ID, d)).toEqual({ ok: false, reason: "unavailable" });
    expect(d.estimate).not.toHaveBeenCalled();
  });

  it("refuses when the caller is over the limit", async () => {
    const d = deps({ rateLimit: vi.fn(async () => false) });
    expect(await quoteRemainingInEurc(ID, d)).toEqual({ ok: false, reason: "rate_limited" });
    expect(d.readInvoice).not.toHaveBeenCalled();
  });

  it("refuses an unregistered invoice", async () => {
    const d = deps({ readInvoice: vi.fn(async () => null) });
    expect(await quoteRemainingInEurc(ID, d)).toEqual({ ok: false, reason: "not_found" });
    expect(d.estimate).not.toHaveBeenCalled();
  });

  it.each([
    ["fully netted", invoice({ status: InvoiceStatus.ExtinguishedOnchain, amountRemaining: 0n })],
    ["zero remaining", invoice({ amountRemaining: 0n })],
  ])("refuses an invoice with nothing remaining (%s)", async (_label, inv) => {
    const d = deps({ readInvoice: vi.fn(async () => inv) });
    expect(await quoteRemainingInEurc(ID, d)).toEqual({ ok: false, reason: "nothing_remaining" });
    expect(d.estimate).not.toHaveBeenCalled();
  });

  it("serves a cached quote for the same chain and amount without asking Circle again", async () => {
    const d = deps();
    const first = await quoteRemainingInEurc(ID, d);
    const second = await quoteRemainingInEurc(ID, d);

    expect(d.estimate).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(d.cacheSet).toHaveBeenCalledWith(quoteCacheKey(ARC_TESTNET_CHAIN_ID, "12.345"), expect.anything(), 60);
  });

  it("still quotes when the cache itself is down", async () => {
    const d = deps({
      cacheGet: vi.fn(async () => Promise.reject(new Error("down"))),
      cacheSet: vi.fn(async () => Promise.reject(new Error("down"))),
    });
    expect((await quoteRemainingInEurc(ID, d)).ok).toBe(true);
  });

  it.each([
    ["Swap Kit throws", vi.fn(async () => Promise.reject(new Error("503")))],
    ["the output token isn't EURC", vi.fn(async (a: string) => estimate(a, "10.1", "USDT"))],
    ["the output is zero", vi.fn(async (a: string) => estimate(a, "0"))],
    ["the output isn't a decimal", vi.fn(async (a: string) => estimate(a, "NaN"))],
    ["the quoted input doesn't match the invoice", vi.fn(async () => estimate("1"))],
  ])("reports unavailable, never a number, when %s", async (_label, estimateFn) => {
    const d = deps({ estimate: estimateFn });
    expect(await quoteRemainingInEurc(ID, d)).toEqual({ ok: false, reason: "unavailable" });
    expect(d.cacheSet).not.toHaveBeenCalled();
  });

  it("reports unavailable when the Registry read fails", async () => {
    const d = deps({ readInvoice: vi.fn(async () => Promise.reject(new Error("rpc"))) });
    expect(await quoteRemainingInEurc(ID, d)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("swapQuoteSupported", () => {
  it("is true for both Arc networks and false for anything else", () => {
    expect(swapQuoteSupported(ARC_TESTNET_CHAIN_ID)).toBe(true);
    expect(swapQuoteSupported(ARC_MAINNET_CHAIN_ID)).toBe(true);
    expect(swapQuoteSupported(1)).toBe(false);
  });
});

describe("quote display helpers", () => {
  it.each([
    ["10.146739", "10.15"],
    ["10.144999", "10.14"],
    ["0.005", "0.01"],
    ["12.345", "12.35"],
    ["99.995", "100.00"],
    ["7", "7.00"],
    ["0", "0.00"],
  ])("rounds %s to %s for display", (input, expected) => {
    expect(roundDecimalString(input, 2)).toBe(expected);
  });

  it("leaves anything that isn't a plain decimal untouched", () => {
    expect(roundDecimalString("1e5", 2)).toBe("1e5");
  });

  it("formats the quote time in UTC", () => {
    expect(formatQuoteTime(NOW.toISOString())).toBe("14:05 UTC");
  });

  it("is on unless explicitly switched off", () => {
    expect(eurcQuoteEnabled(undefined)).toBe(true);
    expect(eurcQuoteEnabled("on")).toBe(true);
    expect(eurcQuoteEnabled(" OFF ")).toBe(false);
  });
});
