/// The canonical settlement receipt: block, transaction hash, and before/after amountRemaining
/// for every invoice a settle() call extinguished — the on-chain evidence a cycle really
/// cleared, not just a UI claim that it did. Shared, not demo-specific: `/app/receipt/[txHash]`
/// renders the same component against the same shape, so "the demo's receipt" and "the real
/// receipt" are never two different designs.
///
/// Layout: header block -> dashed separator -> itemized rows -> totals.

import { Money } from "../ui/Money";
import { EurcQuote } from "../quote/EurcQuote";
import { parseUnits } from "viem";

export interface ReceiptInvoiceRow {
  label: string;
  invoiceId: string;
  beforeUsdc: string;
  afterUsdc: string;
}

export interface ReceiptData {
  txHash: string;
  explorerUrl: string;
  blockNumber: string;
  wNetUsdc: string;
  grossCancelledUsdc: string;
  cashMovedUsdc: string;
  multiplierLabel: string;
  gasPaidUsdc: string | null;
  invoices: ReceiptInvoiceRow[];
}

/// Still owed after this settlement. The quote itself reads the live amount from the Registry.
function hasRemaining(afterUsdc: string): boolean {
  return parseUnits(afterUsdc, 6) > 0n;
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function Receipt({ data }: { data: ReceiptData }) {
  return (
    <div className="animate-card-entrance rounded-card border border-gold/30 bg-gold/[0.06] p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
              <path
                d="M3 8.5 L6.5 12 L13 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-check-draw"
                pathLength={32}
              />
            </svg>
            Settled
          </span>
          <h2 className="mt-3 heading-2">Settlement receipt</h2>
        </div>
        <div className="text-right text-xs text-muted">
          <p>
            Block <span className="text-foreground">{data.blockNumber}</span>
          </p>
          <a href={data.explorerUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-gold hover:underline">
            {shortHash(data.txHash)} →
          </a>
        </div>
      </div>

      <div className="mt-6 border-t border-dashed border-white/15 pt-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Invoices cancelled</p>
        <div className="mt-3 divide-y divide-white/10">
          {data.invoices.map((row) => (
            <div key={row.invoiceId} className="py-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-foreground/90">{row.label}</span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  <Money value={row.beforeUsdc} className="text-muted line-through" />
                  <Money value={row.afterUsdc} className="text-gold" />
                </span>
              </div>
              {hasRemaining(row.afterUsdc) && <EurcQuote invoiceId={row.invoiceId} className="mt-2 text-right" />}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 border-t border-dashed border-white/15 pt-6">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Cancelled</dt>
            <dd className="mt-1 figure text-xl"><Money value={data.grossCancelledUsdc} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Cash moved</dt>
            <dd className="mt-1 figure text-xl"><Money value={data.cashMovedUsdc} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Multiplier</dt>
            <dd className="mt-1 figure text-xl">{data.multiplierLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Gas paid</dt>
            <dd className="mt-1 figure text-xl">{data.gasPaidUsdc === null ? "Unknown" : <Money value={data.gasPaidUsdc} />}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
