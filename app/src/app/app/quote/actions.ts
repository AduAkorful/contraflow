"use server";

/// Public, unauthenticated: the receipt and history pages work without sign-in, so the quote does
/// too. The only input is an invoice id; the amount is read from the Registry.

import { addressesForChain, APP_CHAIN_ID } from "@/src/contracts/addresses";
import { chainById, createArcPublicClient } from "@/src/chain/client";
import { getInvoice } from "@/src/chain/readInvoices";
import {
  estimateWithThrowawayKit,
  QUOTE_RATE_LIMIT,
  quoteRemainingInEurc,
  quoteUsdcAmountInEurc,
  swapQuoteSupported,
} from "@/src/kits/quote";
import { getSession } from "@/src/session/getSession";
import { eurcQuoteEnabled, type EurcQuote, type EurcQuoteResult } from "@/src/kits/quoteFormat";
import { checkRateLimit } from "@/src/ratelimit/limiter";
import { requestIp } from "@/src/ratelimit/requestIp";
import { redis } from "@/src/upstash/client";

const CHAIN_ID = APP_CHAIN_ID;

export async function quoteInvoiceRemainingInEurc(invoiceId: string): Promise<EurcQuoteResult> {
  if (!eurcQuoteEnabled() || !swapQuoteSupported(CHAIN_ID)) return { ok: false, reason: "unavailable" };

  const { registry } = addressesForChain(CHAIN_ID);
  const client = createArcPublicClient(CHAIN_ID);
  const ip = await requestIp();

  return quoteRemainingInEurc(invoiceId, {
    chainId: CHAIN_ID,
    chainLabel: chainById(CHAIN_ID).name,
    readInvoice: (id) => getInvoice(client, registry, id),
    estimate: estimateWithThrowawayKit(CHAIN_ID),
    rateLimit: async () =>
      (await checkRateLimit(`eurc-quote:${ip}`, QUOTE_RATE_LIMIT.maxRequests, QUOTE_RATE_LIMIT.windowSeconds)).allowed,
    cacheGet: (key) => redis().get<EurcQuote>(key),
    cacheSet: async (key, value, ttlSeconds) => {
      await redis().set(key, value, { ex: ttlSeconds });
    },
    now: () => new Date(),
  });
}

/// The Balance page's quote: an amount the signed-in user typed, not a Registry value. Requiring a
/// session and limiting per address (not per IP) is what keeps this from being an open quote
/// proxy for the public.
export async function quoteUsdcAmount(amountInUsdc: string): Promise<EurcQuoteResult> {
  if (!eurcQuoteEnabled() || !swapQuoteSupported(CHAIN_ID)) return { ok: false, reason: "unavailable" };
  const session = await getSession();
  if (!session) return { ok: false, reason: "sign_in" };
  const address = session.address.toLowerCase();

  return quoteUsdcAmountInEurc(amountInUsdc, {
    chainId: CHAIN_ID,
    chainLabel: chainById(CHAIN_ID).name,
    estimate: estimateWithThrowawayKit(CHAIN_ID),
    rateLimit: async () =>
      (await checkRateLimit(`eurc-quote-amount:${address}`, QUOTE_RATE_LIMIT.maxRequests, QUOTE_RATE_LIMIT.windowSeconds)).allowed,
    cacheGet: (key) => redis().get<EurcQuote>(key),
    cacheSet: async (key, value, ttlSeconds) => {
      await redis().set(key, value, { ex: ttlSeconds });
    },
    now: () => new Date(),
  });
}
