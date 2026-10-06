"use server";

/// Public, unauthenticated: the receipt and history pages work without sign-in, so the quote does
/// too. The only input is an invoice id; the amount is read from the Registry.

import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "@/src/contracts/addresses";
import { chainById, createArcPublicClient } from "@/src/chain/client";
import { getInvoice } from "@/src/chain/readInvoices";
import {
  estimateWithThrowawayKit,
  QUOTE_RATE_LIMIT,
  quoteRemainingInEurc,
  swapQuoteSupported,
} from "@/src/kits/quote";
import { eurcQuoteEnabled, type EurcQuote, type EurcQuoteResult } from "@/src/kits/quoteFormat";
import { checkRateLimit } from "@/src/ratelimit/limiter";
import { requestIp } from "@/src/ratelimit/requestIp";
import { redis } from "@/src/upstash/client";

const CHAIN_ID = ARC_TESTNET_CHAIN_ID;

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
