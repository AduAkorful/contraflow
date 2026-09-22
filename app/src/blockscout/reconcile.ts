/// Reconciles a single address's invoice history against the Registry contract's on-chain log
/// history, backfilling anything the write path in `app/app/app/demo/actions.ts` missed — a write
/// that succeeded on-chain but crashed before the database write landed, or a `register()` call
/// made directly against the contract (permissionless) without ever going through this app.

import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { fetchContractLogs, fetchTransactionFee, paramValue, type DecodedLog } from "./client";
import {
  getInvoicesForAddress,
  upsertRegisteredInvoice,
  upsertSettledInvoice,
  upsertSettlement,
  type InvoiceRow,
} from "../db/invoices";

const USDC_DECIMALS = 1_000_000n;
function formatUsdc(baseUnits: bigint): string {
  return (Number(baseUnits) / Number(USDC_DECIMALS)).toFixed(2);
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export interface RegisteredEvent {
  invoiceRef: string;
  debtor: string;
  creditor: string;
  amountBaseUnits: bigint;
  maturity: string;
  earlyNetConsent: boolean;
  nonce: bigint;
  registerTxHash: string;
}

export interface NettedEvent {
  invoiceRef: string;
  wNetBaseUnits: bigint;
  remainingAfterBaseUnits: bigint;
  transactionHash: string;
}

export function parseRegistered(log: DecodedLog): RegisteredEvent | null {
  if (log.methodCall?.startsWith("InvoiceRegistered") !== true) return null;
  const id = paramValue(log.parameters, "id");
  const debtor = paramValue(log.parameters, "debtor");
  const creditor = paramValue(log.parameters, "creditor");
  const amount = paramValue(log.parameters, "amount");
  const maturity = paramValue(log.parameters, "maturity");
  const earlyNetConsent = paramValue(log.parameters, "earlyNetConsent");
  const nonce = paramValue(log.parameters, "nonce");
  if (
    typeof id !== "string" ||
    typeof debtor !== "string" ||
    typeof creditor !== "string" ||
    typeof amount !== "string" ||
    typeof maturity !== "string" ||
    typeof nonce !== "string"
  ) {
    return null;
  }
  return {
    invoiceRef: id,
    debtor,
    creditor,
    amountBaseUnits: BigInt(amount),
    maturity,
    earlyNetConsent: earlyNetConsent === "true",
    nonce: BigInt(nonce),
    registerTxHash: log.transactionHash,
  };
}

export function parseNetted(log: DecodedLog): NettedEvent | null {
  if (log.methodCall?.startsWith("InvoiceNetted") !== true) return null;
  const id = paramValue(log.parameters, "id");
  const wNet = paramValue(log.parameters, "wNet");
  const remainingAfter = paramValue(log.parameters, "remainingAfter");
  if (typeof id !== "string" || typeof wNet !== "string" || typeof remainingAfter !== "string") return null;
  return {
    invoiceRef: id,
    wNetBaseUnits: BigInt(wNet),
    remainingAfterBaseUnits: BigInt(remainingAfter),
    transactionHash: log.transactionHash,
  };
}

export interface ReconcileResult {
  invoices: InvoiceRow[];
  reconciled: boolean;
  error?: string;
}

/// Reads whatever's already in the database for `address` immediately, then reconciles against
/// Blockscout's Registry log history and returns the (possibly updated) result. Never throws for a
/// Blockscout-side failure — the database read still succeeds and is returned with
/// `reconciled: false`, since a reconciliation failure shouldn't take down the fast path it exists
/// to backstop.
export async function reconcileAddress(address: string): Promise<ReconcileResult> {
  let existing: InvoiceRow[];
  try {
    existing = await getInvoicesForAddress(address);
  } catch (err) {
    return { invoices: [], reconciled: false, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { registry } = addressesForChain(ARC_TESTNET_CHAIN_ID);
    const logs = await fetchContractLogs(registry);

    const registered: RegisteredEvent[] = [];
    const netted: NettedEvent[] = [];
    for (const log of logs) {
      const r = parseRegistered(log);
      if (r) registered.push(r);
      const n = parseNetted(log);
      if (n) netted.push(n);
    }

    // Group ALL netted events (not just this address's) by tx hash so cycleLength reflects the
    // true full cycle size, not just how many of the cycle's invoices touch this address.
    const nettedByTx = new Map<string, NettedEvent[]>();
    for (const n of netted) {
      const bucket = nettedByTx.get(n.transactionHash) ?? [];
      bucket.push(n);
      nettedByTx.set(n.transactionHash, bucket);
    }

    const myInvoiceRefs = new Set(existing.map((row) => row.invoiceRef));
    for (const r of registered) {
      if (sameAddress(r.debtor, address) || sameAddress(r.creditor, address)) {
        myInvoiceRefs.add(r.invoiceRef);
        await upsertRegisteredInvoice({
          invoiceRef: r.invoiceRef,
          debtor: r.debtor,
          creditor: r.creditor,
          amountUsdc: formatUsdc(r.amountBaseUnits),
          maturity: r.maturity,
          earlyNetConsent: r.earlyNetConsent,
          registerTxHash: r.registerTxHash,
        });
      }
    }

    const settleTxHashesTouched = new Set<string>();
    for (const n of netted) {
      if (!myInvoiceRefs.has(n.invoiceRef)) continue;
      settleTxHashesTouched.add(n.transactionHash);
      await upsertSettledInvoice({
        invoiceRef: n.invoiceRef,
        settleTxHash: n.transactionHash,
        wNetUsdc: formatUsdc(n.wNetBaseUnits),
        remainingUsdc: formatUsdc(n.remainingAfterBaseUnits),
      });
    }

    for (const settleTxHash of settleTxHashesTouched) {
      const cycle = nettedByTx.get(settleTxHash) ?? [];
      const wNetUsdc = formatUsdc(cycle[0]?.wNetBaseUnits ?? 0n);
      const fee = await fetchTransactionFee(settleTxHash);
      await upsertSettlement({
        settleTxHash,
        blockNumber: String(fee.blockNumber),
        wNetUsdc,
        cycleLength: cycle.length,
        gasPaidWei: fee.gasPaidWei,
      });
    }

    const refreshed = await getInvoicesForAddress(address);
    return { invoices: refreshed, reconciled: true };
  } catch (err) {
    return {
      invoices: existing,
      reconciled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
