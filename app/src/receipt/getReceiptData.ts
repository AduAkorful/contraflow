/// DB-first, Blockscout-fallback receipt lookup for `/app/receipt/[txHash]` —
/// plans/19-database-blockscout-reconciliation.md. The fallback works even for an empty or wrong
/// database: `InvoiceNetted`/`Settled`'s own decoded event data carries everything needed
/// (`before = remainingAfter + wNet`), same formula `app/app/app/demo/actions.ts` already uses.

import { getSettlement, getInvoicesForSettlement } from "../db/invoices";
import { fetchTransactionFee, fetchTransactionLogs, paramValue } from "../blockscout/client";
import type { ReceiptData, ReceiptInvoiceRow } from "../../components/receipt/Receipt";

const USDC_DECIMALS = 1_000_000n;
function formatUsdc(baseUnits: bigint): string {
  return (Number(baseUnits) / Number(USDC_DECIMALS)).toFixed(2);
}

const NATIVE_USDC_DECIMALS = 10n ** 18n;
function formatNativeUsdc(wei: bigint): string {
  return (Number(wei) / Number(NATIVE_USDC_DECIMALS)).toFixed(6);
}

function shortRef(ref: string): string {
  return `${ref.slice(0, 10)}…${ref.slice(-6)}`;
}

/// Adds two USDC decimal strings (as stored/formatted, always 2 decimal places) in integer-cent
/// space rather than base-unit bigints, so a DB-stored row (already human-decimal) never has to
/// round-trip back through 1e6 base units just to add two numbers together.
function addUsdcCents(a: string, b: string): string {
  const cents = Math.round(Number(a) * 100) + Math.round(Number(b) * 100);
  return (cents / 100).toFixed(2);
}

function explorerTxUrl(txHash: string): string {
  return `https://explorer.testnet.arc.io/tx/${txHash}`;
}

async function fromDatabase(txHash: string): Promise<ReceiptData | null> {
  const settlement = await getSettlement(txHash);
  if (!settlement) return null;
  const invoices = await getInvoicesForSettlement(txHash);

  const rows: ReceiptInvoiceRow[] = invoices.map((inv) => ({
    label: shortRef(inv.invoiceRef),
    invoiceId: inv.invoiceRef,
    beforeUsdc: addUsdcCents(inv.remainingUsdc ?? "0.00", settlement.wNetUsdc),
    afterUsdc: inv.remainingUsdc ?? "0.00",
  }));

  const grossCancelledUsdc = (Number(settlement.wNetUsdc) * settlement.cycleLength).toFixed(2);

  return {
    txHash,
    explorerUrl: explorerTxUrl(txHash),
    blockNumber: settlement.blockNumber,
    wNetUsdc: settlement.wNetUsdc,
    grossCancelledUsdc,
    cashMovedUsdc: "0.00",
    multiplierLabel: "no cash moved",
    gasPaidUsdc: formatNativeUsdc(BigInt(settlement.gasPaidWei)),
    invoices: rows,
  };
}

async function fromBlockscout(txHash: string): Promise<ReceiptData | null> {
  const logs = await fetchTransactionLogs(txHash);
  const nettedLogs = logs.filter((l) => l.methodCall?.startsWith("InvoiceNetted") === true);
  if (nettedLogs.length === 0) return null;

  const fee = await fetchTransactionFee(txHash);

  let wNetBaseUnits = 0n;
  const rows: ReceiptInvoiceRow[] = nettedLogs.map((log) => {
    const id = paramValue(log.parameters, "id");
    const wNet = paramValue(log.parameters, "wNet");
    const remainingAfter = paramValue(log.parameters, "remainingAfter");
    const wNetBig = BigInt(typeof wNet === "string" ? wNet : "0");
    const remainingBig = BigInt(typeof remainingAfter === "string" ? remainingAfter : "0");
    wNetBaseUnits = wNetBig;
    const ref = typeof id === "string" ? id : "unknown";
    return {
      label: shortRef(ref),
      invoiceId: ref,
      beforeUsdc: formatUsdc(remainingBig + wNetBig),
      afterUsdc: formatUsdc(remainingBig),
    };
  });

  const grossCancelledUsdc = formatUsdc(wNetBaseUnits * BigInt(rows.length));

  return {
    txHash,
    explorerUrl: explorerTxUrl(txHash),
    blockNumber: String(fee.blockNumber),
    wNetUsdc: formatUsdc(wNetBaseUnits),
    grossCancelledUsdc,
    cashMovedUsdc: "0.00",
    multiplierLabel: "no cash moved",
    gasPaidUsdc: formatNativeUsdc(BigInt(fee.gasPaidWei)),
    invoices: rows,
  };
}

export async function getReceiptData(txHash: string): Promise<ReceiptData | null> {
  const fromDb = await fromDatabase(txHash);
  if (fromDb) return fromDb;
  return fromBlockscout(txHash);
}
