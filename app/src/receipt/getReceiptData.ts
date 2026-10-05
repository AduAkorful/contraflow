/// DB-first, Blockscout-fallback receipt lookup for `/app/receipt/[txHash]`. The fallback works
/// even for an empty or wrong database: `InvoiceNetted`/`Settled`'s own decoded event data
/// carries everything needed
/// (`before = remainingAfter + wNet`), same formula `app/app/app/demo/actions.ts` already uses.

import { getSettlement, getInvoicesForSettlement } from "../db/invoices";
import { fetchTransactionFee, fetchTransactionLogs, paramValue } from "../blockscout/client";
import type { ReceiptData, ReceiptInvoiceRow } from "../../components/receipt/Receipt";
import { formatUnits, parseUnits } from "viem";
import { formatUsdcDisplay } from "../attest/amount";
import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { arcPublicClient } from "../chain/operatorEnv";
import { getInvoice } from "../chain/readInvoices";

const USDC_DECIMALS = 6;

const NATIVE_USDC_DECIMALS = 10n ** 12n;
function formatNativeUsdc(wei: bigint): string {
  const roundedSixDecimalUnits = (wei + NATIVE_USDC_DECIMALS / 2n) / NATIVE_USDC_DECIMALS;
  return formatUnits(roundedSixDecimalUnits, 6);
}

function shortRef(ref: string): string {
  return `${ref.slice(0, 10)}…${ref.slice(-6)}`;
}

/// Adds stored human-readable USDC values in exact six-decimal base units.
function addUsdcAmounts(a: string, b: string): string {
  return formatUsdcDisplay(parseUnits(a, USDC_DECIMALS) + parseUnits(b, USDC_DECIMALS));
}

function explorerTxUrl(txHash: string): string {
  return `https://explorer.testnet.arc.io/tx/${txHash}`;
}

async function fromDatabase(txHash: string): Promise<ReceiptData | null> {
  const settlement = await getSettlement(txHash);
  if (!settlement) return null;
  const invoices = await getInvoicesForSettlement(txHash);
  // A cached settlement is complete only when its transaction-specific rows cover the event's
  // full cycle. Otherwise reconstruct from the authenticated transaction logs below.
  if (invoices.length !== settlement.cycleLength || invoices.length === 0) return null;

  const rows: ReceiptInvoiceRow[] = invoices.map((inv) => ({
    label: shortRef(inv.invoiceRef),
    invoiceId: inv.invoiceRef,
    beforeUsdc: addUsdcAmounts(inv.remainingUsdc ?? "0.00", settlement.wNetUsdc),
    afterUsdc: inv.remainingUsdc ?? "0.00",
    debtor: inv.debtor,
    creditor: inv.creditor,
  }));

  const grossCancelledUsdc = formatUsdcDisplay(parseUnits(settlement.wNetUsdc, USDC_DECIMALS) * BigInt(settlement.cycleLength));

  return {
    txHash,
    explorerUrl: explorerTxUrl(txHash),
    blockNumber: settlement.blockNumber,
    wNetUsdc: settlement.wNetUsdc,
    grossCancelledUsdc,
    cashMovedUsdc: "0.00",
    multiplierLabel: "no cash moved",
    gasPaidUsdc: settlement.gasPaidWei === null ? null : formatNativeUsdc(BigInt(settlement.gasPaidWei)),
    invoices: rows,
  };
}

async function fromBlockscout(txHash: string): Promise<ReceiptData | null> {
  const logs = await fetchTransactionLogs(txHash);
  const { registry, settler } = addressesForChain(ARC_TESTNET_CHAIN_ID);
  const nettedLogs = logs.filter((l) =>
    (l.address ?? "").toLowerCase() === registry.toLowerCase() && l.methodCall?.startsWith("InvoiceNetted") === true,
  );
  const settledLog = logs.find((l) =>
    (l.address ?? "").toLowerCase() === settler.toLowerCase() && l.methodCall?.startsWith("Settled") === true,
  );
  if (nettedLogs.length === 0 || !settledLog) return null;

  const aggregateIds = settledLog.parameters.find((p) => p.name === "invoiceIds")?.value;
  const aggregateWNet = settledLog.parameters.find((p) => p.name === "wNet")?.value;
  if (!Array.isArray(aggregateIds) || aggregateIds.length !== nettedLogs.length || typeof aggregateWNet !== "string") return null;
  const eventIds = nettedLogs.map((log) => log.parameters.find((p) => p.name === "id")?.value);
  if (eventIds.some((id) => typeof id !== "string") ||
      new Set(eventIds as string[]).size !== nettedLogs.length ||
      (aggregateIds as string[]).some((id) => !(eventIds as string[]).some((eventId) => eventId.toLowerCase() === id.toLowerCase()))) return null;
  const eventAmounts = nettedLogs.map((log) => log.parameters.find((p) => p.name === "wNet")?.value);
  if (eventAmounts.some((amount) => amount !== aggregateWNet)) return null;

  const fee = await fetchTransactionFee(txHash);

  // The netting event carries no parties; read them from the Registry, and leave them out rather than
  // fail the receipt if the read doesn't work.
  const client = arcPublicClient();
  async function partiesOf(id: string): Promise<{ debtor: string; creditor: string } | null> {
    try {
      const invoice = await getInvoice(client, registry, id as `0x${string}`);
      return invoice ? { debtor: invoice.debtor, creditor: invoice.creditor } : null;
    } catch {
      return null;
    }
  }

  let wNetBaseUnits = 0n;
  const rows: ReceiptInvoiceRow[] = await Promise.all(
    nettedLogs.map(async (log) => {
      const id = paramValue(log.parameters, "id");
      const wNet = paramValue(log.parameters, "wNet");
      const remainingAfter = paramValue(log.parameters, "remainingAfter");
      const wNetBig = BigInt(typeof wNet === "string" ? wNet : "0");
      const remainingBig = BigInt(typeof remainingAfter === "string" ? remainingAfter : "0");
      wNetBaseUnits = wNetBig;
      const ref = typeof id === "string" ? id : "unknown";
      const parties = typeof id === "string" ? await partiesOf(id) : null;
      return {
        label: shortRef(ref),
        invoiceId: ref,
        beforeUsdc: formatUsdcDisplay(remainingBig + wNetBig),
        afterUsdc: formatUsdcDisplay(remainingBig),
        ...(parties ?? {}),
      };
    }),
  );

  const grossCancelledUsdc = formatUsdcDisplay(wNetBaseUnits * BigInt(rows.length));

  return {
    txHash,
    explorerUrl: explorerTxUrl(txHash),
    blockNumber: String(fee.blockNumber),
    wNetUsdc: formatUsdcDisplay(wNetBaseUnits),
    grossCancelledUsdc,
    cashMovedUsdc: "0.00",
    multiplierLabel: "no cash moved",
    gasPaidUsdc: formatNativeUsdc(BigInt(fee.gasPaidWei)),
    invoices: rows,
  };
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export async function getReceiptData(txHash: string): Promise<ReceiptData | null> {
  // Anything that isn't a transaction hash is "no settlement", before any database or RPC call.
  if (!TX_HASH.test(txHash)) return null;
  let fromDb: ReceiptData | null = null;
  try {
    fromDb = await fromDatabase(txHash);
  } catch {
    // The database is a cache; an outage must not prevent trying authenticated explorer evidence.
  }
  if (fromDb) return fromDb;
  return fromBlockscout(txHash);
}
