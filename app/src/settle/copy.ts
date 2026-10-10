import { formatUsdc } from "../format/money";
import { formatUsdcDisplay } from "../attest/amount";

export function settleLoopSentence(invoiceCount: number, wNetBaseUnits: string): string {
  const each = formatUsdc(formatUsdcDisplay(BigInt(wNetBaseUnits)));
  const total = formatUsdc(formatUsdcDisplay(BigInt(wNetBaseUnits) * BigInt(invoiceCount)));
  return `${invoiceCount} invoices form a loop: ${each} netted from each, ${total} netted in total, no cash moves`;
}
