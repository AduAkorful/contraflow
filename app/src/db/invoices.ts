/// Read/write helpers for the `invoices`/`settlements` tables. Every write is an upsert keyed by
/// the on-chain identifier (`invoice_ref` / `settle_tx_hash`), so calling these twice for the
/// same event (a demo run's own write path, then reconciliation finding the same event again
/// later) never duplicates a row. Every call goes through `withDbRetry` — not precautionary:
/// Neon's HTTP driver can hit genuine, intermittent `ETIMEDOUT`/`ENETUNREACH` connecting to its
/// pooler, with the identical query succeeding seconds before and after a failure.

import { sql, withDbRetry } from "./client";

export type InvoiceStatus = "registered" | "settled";

export interface InvoiceRow {
  invoiceRef: string;
  debtor: string;
  creditor: string;
  amountUsdc: string;
  maturity: string;
  earlyNetConsent: boolean;
  status: InvoiceStatus;
  registerTxHash: string;
  settleTxHash: string | null;
  wNetUsdc: string | null;
  remainingUsdc: string | null;
}

export interface SettlementRow {
  settleTxHash: string;
  blockNumber: string;
  wNetUsdc: string;
  cycleLength: number;
  gasPaidWei: string;
}

function toInvoiceRow(r: Record<string, unknown>): InvoiceRow {
  return {
    invoiceRef: r.invoice_ref as string,
    debtor: r.debtor as string,
    creditor: r.creditor as string,
    amountUsdc: String(r.amount_usdc),
    maturity: String(r.maturity),
    earlyNetConsent: r.early_net_consent as boolean,
    status: r.status as InvoiceStatus,
    registerTxHash: r.register_tx_hash as string,
    settleTxHash: (r.settle_tx_hash as string | null) ?? null,
    wNetUsdc: r.w_net_usdc === null ? null : String(r.w_net_usdc),
    remainingUsdc: r.remaining_usdc === null ? null : String(r.remaining_usdc),
  };
}

function toSettlementRow(r: Record<string, unknown>): SettlementRow {
  return {
    settleTxHash: r.settle_tx_hash as string,
    blockNumber: String(r.block_number),
    wNetUsdc: String(r.w_net_usdc),
    cycleLength: Number(r.cycle_length),
    gasPaidWei: String(r.gas_paid_wei),
  };
}

export interface UpsertRegisteredInvoiceInput {
  invoiceRef: string;
  debtor: string;
  creditor: string;
  amountUsdc: string;
  maturity: string;
  earlyNetConsent: boolean;
  registerTxHash: string;
}

export async function upsertRegisteredInvoice(input: UpsertRegisteredInvoiceInput): Promise<void> {
  await withDbRetry(async () => {
    const db = sql();
    await db`
      INSERT INTO invoices (invoice_ref, debtor, creditor, amount_usdc, maturity, early_net_consent, status, register_tx_hash)
      VALUES (${input.invoiceRef}, ${input.debtor}, ${input.creditor}, ${input.amountUsdc}, ${input.maturity}, ${input.earlyNetConsent}, 'registered', ${input.registerTxHash})
      ON CONFLICT (invoice_ref) DO UPDATE SET
        debtor = EXCLUDED.debtor,
        creditor = EXCLUDED.creditor,
        amount_usdc = EXCLUDED.amount_usdc,
        maturity = EXCLUDED.maturity,
        early_net_consent = EXCLUDED.early_net_consent,
        register_tx_hash = EXCLUDED.register_tx_hash,
        updated_at = now()
    `;
  });
}

export interface UpsertSettledInvoiceInput {
  invoiceRef: string;
  settleTxHash: string;
  wNetUsdc: string;
  remainingUsdc: string;
}

export async function upsertSettledInvoice(input: UpsertSettledInvoiceInput): Promise<void> {
  await withDbRetry(async () => {
    const db = sql();
    await db`
      UPDATE invoices SET
        status = 'settled',
        settle_tx_hash = ${input.settleTxHash},
        w_net_usdc = ${input.wNetUsdc},
        remaining_usdc = ${input.remainingUsdc},
        updated_at = now()
      WHERE invoice_ref = ${input.invoiceRef}
    `;
  });
}

export async function upsertSettlement(input: SettlementRow): Promise<void> {
  await withDbRetry(async () => {
    const db = sql();
    await db`
      INSERT INTO settlements (settle_tx_hash, block_number, w_net_usdc, cycle_length, gas_paid_wei)
      VALUES (${input.settleTxHash}, ${input.blockNumber}, ${input.wNetUsdc}, ${input.cycleLength}, ${input.gasPaidWei})
      ON CONFLICT (settle_tx_hash) DO UPDATE SET
        block_number = EXCLUDED.block_number,
        w_net_usdc = EXCLUDED.w_net_usdc,
        cycle_length = EXCLUDED.cycle_length,
        gas_paid_wei = EXCLUDED.gas_paid_wei
    `;
  });
}

export async function getInvoicesForAddress(address: string): Promise<InvoiceRow[]> {
  return withDbRetry(async () => {
    const db = sql();
    const rows = await db`
      SELECT * FROM invoices WHERE debtor = ${address} OR creditor = ${address} ORDER BY created_at DESC
    `;
    return (rows as Record<string, unknown>[]).map(toInvoiceRow);
  });
}

export async function getSettlement(settleTxHash: string): Promise<SettlementRow | null> {
  return withDbRetry(async () => {
    const db = sql();
    const rows = await db`SELECT * FROM settlements WHERE settle_tx_hash = ${settleTxHash}`;
    const first = (rows as Record<string, unknown>[])[0];
    return first ? toSettlementRow(first) : null;
  });
}

export async function getInvoicesForSettlement(settleTxHash: string): Promise<InvoiceRow[]> {
  return withDbRetry(async () => {
    const db = sql();
    const rows = await db`SELECT * FROM invoices WHERE settle_tx_hash = ${settleTxHash} ORDER BY created_at ASC`;
    return (rows as Record<string, unknown>[]).map(toInvoiceRow);
  });
}

export async function getInvoiceByRef(invoiceRef: string): Promise<InvoiceRow | null> {
  return withDbRetry(async () => {
    const db = sql();
    const rows = await db`SELECT * FROM invoices WHERE invoice_ref = ${invoiceRef}`;
    const first = (rows as Record<string, unknown>[])[0];
    return first ? toInvoiceRow(first) : null;
  });
}
