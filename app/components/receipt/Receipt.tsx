/// The canonical settlement receipt: block, transaction hash, and before/after amountRemaining
/// for every invoice a settle() call netted — the onchain evidence a cycle really
/// cleared, not just a UI claim that it did. Shared, not demo-specific: `/app/receipt/[txHash]`
/// renders the same component against the same shape, so "the demo's receipt" and "the real
/// receipt" are never two different designs.
///
/// Layout: header -> what happened in one sentence -> one row per invoice (who owes whom,
/// before, netted, after, status) -> totals.

import { Address } from "../ui/Address";
import { Money } from "../ui/Money";
import { EurcQuote } from "../quote/EurcQuote";
import { parseUnits } from "viem";
import { NETTING_STATUS_LABEL, nettingStatus } from "../../src/format/netting";

export interface ReceiptInvoiceRow {
  label: string;
  invoiceId: string;
  beforeUsdc: string;
  afterUsdc: string;
  /// Present when the parties could be read; the demo supplies a readable `label` instead.
  debtor?: string;
  creditor?: string;
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

function Parties({ row }: { row: ReceiptInvoiceRow }) {
  if (row.debtor && row.creditor) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2">
        <Address address={row.debtor} className="text-foreground" />
        <span aria-label="owes" className="text-faint">→</span>
        <Address address={row.creditor} className="text-foreground" />
      </span>
    );
  }
  return <span className="text-foreground">{row.label}</span>;
}

function Figure({ label, children, emphasis }: { label: string; children: React.ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className={`mt-0.5 tabular-nums ${emphasis ? "text-foreground" : "text-muted"}`}>{children}</dd>
    </div>
  );
}

export function Receipt({ data }: { data: ReceiptData }) {
  const count = data.invoices.length;
  return (
    <div className="rounded-card border border-border-subtle bg-surface-1 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
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

      <p className="mt-5 text-sm text-muted">
        <Money value={data.wNetUsdc} className="text-foreground" /> netted from each of {count} invoices in one
        transaction. <Money value={data.cashMovedUsdc} className="text-foreground" /> moved between the parties.
      </p>

      <ul className="mt-6 divide-y divide-border-subtle border-y border-border-subtle">
        {data.invoices.map((row) => {
          const status = nettingStatus(row.beforeUsdc, row.afterUsdc);
          return (
            <li key={row.invoiceId} className="py-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Parties row={row} />
                <span className="rounded-md border border-border-input px-2 py-0.5 text-xs text-muted">{NETTING_STATUS_LABEL[status]}</span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-4">
                <Figure label="Before">
                  <Money value={row.beforeUsdc} />
                </Figure>
                <Figure label="Netted">
                  <Money value={data.wNetUsdc} />
                </Figure>
                <Figure label="Remaining" emphasis>
                  <Money value={row.afterUsdc} />
                </Figure>
              </dl>
              {hasRemaining(row.afterUsdc) && (
                <details className="mt-3">
                  <summary className="cursor-pointer list-none text-xs text-muted" aria-label="More actions">
                    ⋯
                  </summary>
                  <div className="mt-2">
                    <EurcQuote invoiceId={row.invoiceId} />
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-faint">Netted in total</dt>
          <dd className="mt-1 figure text-lg"><Money value={data.grossCancelledUsdc} /></dd>
        </div>
        <div>
          <dt className="text-xs text-faint">USDC moved</dt>
          <dd className="mt-1 figure text-lg"><Money value={data.cashMovedUsdc} /></dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Gas paid</dt>
          <dd className="mt-1 figure text-lg">{data.gasPaidUsdc === null ? "Unknown" : <Money value={data.gasPaidUsdc} />}</dd>
        </div>
      </dl>
    </div>
  );
}
