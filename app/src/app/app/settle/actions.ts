"use server";

import type { Address, Hex } from "viem";
import { getSession } from "@/src/session/getSession";
import { checkRateLimit } from "@/src/ratelimit/limiter";
import { redis } from "@/src/upstash/client";
import { addressesForChain, APP_CHAIN_ID } from "@/src/contracts/addresses";
import { fetchContractLogsBounded } from "@/src/blockscout/client";
import { fetchNettableInvoiceEdges } from "@/src/chain/readInvoices";
import { defaultComplianceProvider, filterFlaggedInvoices } from "@/src/compliance";
import { arcPublicClient } from "@/src/chain/operatorEnv";
import { findInvoiceLoopFor, type InvoiceLoopResult } from "@/src/settle/invoiceLoops";
import { getReceiptData } from "@/src/receipt/getReceiptData";
import { fetchTransactionFee } from "@/src/blockscout/client";
import { upsertSettledInvoice, upsertSettlement } from "@/src/db/invoices";

const RATE_MAX = 10;
const RATE_WINDOW_SECONDS = 60;
const CACHE_TTL_SECONDS = 30;

export interface InvoiceLoopView {
  kind: "loop";
  chainId: number;
  settler: Address;
  invoiceIds: Hex[];
  wNet: string;
  legs: { id: Hex; debtor: Address; creditor: Address; remaining: string }[];
}

export type FindSettleableLoopResult =
  | InvoiceLoopView
  | { kind: "none" }
  | { kind: "incomplete" }
  | { kind: "error"; error: string };

function viewFrom(result: InvoiceLoopResult, chainId: number, settler: Address): FindSettleableLoopResult {
  if (result.kind !== "loop") return result;
  return {
    kind: "loop",
    chainId,
    settler,
    invoiceIds: result.invoiceIds,
    wNet: result.wNet.toString(),
    legs: result.legs.map((leg) => ({
      id: leg.id,
      debtor: leg.debtor,
      creditor: leg.creditor,
      remaining: leg.remaining.toString(),
    })),
  };
}

export async function findSettleableLoop(): Promise<FindSettleableLoopResult> {
  const session = await getSession();
  if (!session) return { kind: "error", error: "Sign in first." };
  const party = session.address as Address;

  try {
    const { allowed } = await checkRateLimit(`settle:loop:${party.toLowerCase()}`, RATE_MAX, RATE_WINDOW_SECONDS);
    if (!allowed) return { kind: "error", error: "Too many loop checks. Try again in a minute." };
  } catch {
    return { kind: "error", error: "Couldn't check for loops right now." };
  }

  const chainId = APP_CHAIN_ID;
  const { registry, settler } = addressesForChain(chainId);

  let scan;
  try {
    scan = await fetchContractLogsBounded(registry);
  } catch {
    return { kind: "incomplete" };
  }

  const head = scan.logs[0] ? `${scan.logs[0].blockNumber}:${scan.logs[0].logIndex ?? 0}:${scan.truncated ? "t" : "f"}` : "empty";
  const cacheKey = `settle:loop:${chainId}:${party.toLowerCase()}:${head}`;
  try {
    const hit = await redis().get<FindSettleableLoopResult>(cacheKey);
    if (hit && typeof hit === "object" && "kind" in hit) return hit;
  } catch {
    // Cache misses are fine; a limiter failure already failed closed above.
  }

  let result: InvoiceLoopResult;
  try {
    result = await findInvoiceLoopFor(party, {
      fetchLogs: async () => scan,
      fetchNettable: (ids) => fetchNettableInvoiceEdges(arcPublicClient(), registry, ids),
      filterFlagged: async (edges) => {
        const { clearInvoices } = await filterFlaggedInvoices(edges, defaultComplianceProvider());
        return clearInvoices;
      },
    });
  } catch (err) {
    console.error("Loop search failed:", err);
    return { kind: "error", error: "Couldn't check for loops right now." };
  }
  const view = viewFrom(result, chainId, settler);
  try {
    await redis().set(cacheKey, view, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Serving the fresh value matters more than caching it.
  }
  return view;
}

export type RecordSettlementResult = { ok: true } | { ok: false; error: string };

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export async function recordSettlement(txHash: string): Promise<RecordSettlementResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };
  if (!TX_HASH.test(txHash)) return { ok: false, error: "Not a settlement transaction." };

  let receipt;
  try {
    receipt = await getReceiptData(txHash);
  } catch {
    return { ok: false, error: "Couldn't confirm this settlement yet." };
  }
  if (!receipt) return { ok: false, error: "No settlement found for that transaction." };

  const party = session.address.toLowerCase();
  // Membership must be proven from a row that names its parties; with none named, the caller's
  // place in the loop can't be confirmed, so nothing is written and reconciliation backfills.
  const named = receipt.invoices.filter((row) => row.debtor && row.creditor);
  if (named.length === 0) return { ok: false, error: "Couldn't confirm this settlement yet." };
  const inLoop = named.some((row) => row.debtor?.toLowerCase() === party || row.creditor?.toLowerCase() === party);
  if (!inLoop) return { ok: false, error: "No settlement found for that transaction." };

  try {
    await upsertSettledInvoiceRows(txHash, receipt);
  } catch (err) {
    console.error("settle write-through failed (reconciliation will backfill):", err);
  }
  return { ok: true };
}

async function upsertSettledInvoiceRows(txHash: string, receipt: NonNullable<Awaited<ReturnType<typeof getReceiptData>>>) {
  let gasPaidWei: string | null = null;
  try {
    const fee = await fetchTransactionFee(txHash);
    gasPaidWei = fee.gasPaidWei;
  } catch {
    gasPaidWei = null;
  }
  for (const row of receipt.invoices) {
    await upsertSettledInvoice({
      invoiceRef: row.invoiceId,
      settleTxHash: txHash,
      wNetUsdc: receipt.wNetUsdc,
      remainingUsdc: row.afterUsdc,
    });
  }
  await upsertSettlement({
    settleTxHash: txHash,
    blockNumber: receipt.blockNumber,
    wNetUsdc: receipt.wNetUsdc,
    cycleLength: receipt.invoices.length,
    gasPaidWei,
  });
}
