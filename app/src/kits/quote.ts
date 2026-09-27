/// Server-only: a live Swap Kit USDC -> EURC quote for what's still owed on one invoice.
///
/// The amount always comes from the Registry (`amountRemaining` by invoice id), never from the
/// caller, so this can't be used as an open quote proxy for arbitrary amounts. The quote is taken
/// from a throwaway, never-funded key: `estimateSwap` requests no signature and moves nothing, and
/// Swap Kit quotes for an address holding no USDC (checked live on Arc testnet and Arc mainnet).
/// That keeps the operator key out of a public path and works on chains the operator key isn't
/// allowed on.

import { formatUnits, isHash, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import type { SwapEstimate } from "@circle-fin/app-kit";

import { createContraflowSwapKit, swapChainForChainId, type ContraflowSwapKit } from "./appkit";
import { estimateUsdcToEurcSwap } from "./swap";
import type { EurcQuote, EurcQuoteResult } from "./quoteFormat";
import { InvoiceStatus, type OnchainInvoice } from "../chain/readInvoices";

/// ERC-20 USDC on Arc (the invoice currency) has 6 decimals; native USDC (gas) has 18.
const USDC_DECIMALS = 6;
const CACHE_TTL_SECONDS = 60;
/// Bump whenever the cached quote shape changes.
const CACHE_VERSION = "v1";
const MAX_REQUESTS = 10;
const WINDOW_SECONDS = 60;

export interface QuoteDeps {
  chainId: number;
  chainLabel: string;
  readInvoice: (invoiceId: Hex) => Promise<OnchainInvoice | null>;
  estimate: (amountInUsdc: string) => Promise<SwapEstimate>;
  /// Resolves `true` when the caller is within its limit. Throwing counts as "not allowed".
  rateLimit: () => Promise<boolean>;
  cacheGet: (key: string) => Promise<EurcQuote | null>;
  cacheSet: (key: string, value: EurcQuote, ttlSeconds: number) => Promise<void>;
  now: () => Date;
}

export function quoteCacheKey(chainId: number, amountInUsdc: string): string {
  return `eurc-quote:${CACHE_VERSION}:${chainId}:${amountInUsdc}`;
}

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
}

export async function quoteRemainingInEurc(invoiceId: string, deps: QuoteDeps): Promise<EurcQuoteResult> {
  if (!isHash(invoiceId)) return { ok: false, reason: "not_found" };

  let allowed: boolean;
  try {
    allowed = await deps.rateLimit();
  } catch {
    // This action is public and each call reaches Circle, so an unreachable limiter fails closed.
    return { ok: false, reason: "unavailable" };
  }
  if (!allowed) return { ok: false, reason: "rate_limited" };

  let invoice: OnchainInvoice | null;
  try {
    invoice = await deps.readInvoice(invoiceId);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!invoice) return { ok: false, reason: "not_found" };
  if (invoice.status !== InvoiceStatus.Active || invoice.amountRemaining === 0n) {
    return { ok: false, reason: "nothing_remaining" };
  }

  const amountInUsdc = formatUnits(invoice.amountRemaining, USDC_DECIMALS);
  const key = quoteCacheKey(deps.chainId, amountInUsdc);

  try {
    const hit = await deps.cacheGet(key);
    if (hit) return { ok: true, quote: hit };
  } catch {
    // A cache miss or outage just means asking Circle directly.
  }

  let estimate: SwapEstimate;
  try {
    estimate = await deps.estimate(amountInUsdc);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  // Never show a figure Swap Kit didn't clearly give us for this exact pair and amount.
  const output = estimate.estimatedOutput;
  if (output?.token !== "EURC" || !isPositiveDecimal(output.amount) || estimate.amountIn !== amountInUsdc) {
    return { ok: false, reason: "unavailable" };
  }

  const quote: EurcQuote = {
    amountInUsdc,
    estimatedOutputEurc: output.amount,
    chainLabel: deps.chainLabel,
    quotedAt: deps.now().toISOString(),
  };
  try {
    await deps.cacheSet(key, quote, CACHE_TTL_SECONDS);
  } catch {
    // Serving the fresh quote matters more than caching it.
  }
  return { ok: true, quote };
}

/// One throwaway swap kit per chain per server process. Its key is generated here, never funded,
/// never logged and never persisted.
const throwawayKits = new Map<number, ContraflowSwapKit>();

export function throwawaySwapKit(chainId: number): ContraflowSwapKit {
  let kit = throwawayKits.get(chainId);
  if (!kit) {
    kit = createContraflowSwapKit(generatePrivateKey(), chainId);
    throwawayKits.set(chainId, kit);
  }
  return kit;
}

/// Whether Swap Kit has a chain mapping for `chainId` at all; the quote is hidden, not broken,
/// where it doesn't.
export function swapQuoteSupported(chainId: number): boolean {
  try {
    swapChainForChainId(chainId);
    return true;
  } catch {
    return false;
  }
}

export const QUOTE_RATE_LIMIT = { maxRequests: MAX_REQUESTS, windowSeconds: WINDOW_SECONDS };

export function estimateWithThrowawayKit(chainId: number) {
  return (amountInUsdc: string) => estimateUsdcToEurcSwap({ swapKit: throwawaySwapKit(chainId), amountInUsdc });
}
