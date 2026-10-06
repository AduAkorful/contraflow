/// Per-currency remaining across a party's active obligations. Closed and out-of-sync rows are
/// excluded; remaining is summed in minor units as BigInt, never as a float.

import { displayMinorAmount } from "../../components/netting/format";
import { formatUsdc, usdcBaseUnits } from "../format/money";
import type { InvoiceRow } from "../db/invoices";
import type { ObligationStatus } from "../db/obligations";
import type { ObligationSummary } from "./service";

export interface CurrencyPosition {
  currency: string;
  youOwe: bigint;
  owedToYou: bigint;
}

export function obligationPositionByCurrency(obligations: ObligationSummary[]): CurrencyPosition[] {
  const map = new Map<string, { youOwe: bigint; owedToYou: bigint }>();
  for (const o of obligations) {
    if (o.status !== "active") continue;
    const remaining = BigInt(o.remaining);
    const slot = map.get(o.currency) ?? { youOwe: 0n, owedToYou: 0n };
    if (o.youOwe) slot.youOwe += remaining;
    else slot.owedToYou += remaining;
    map.set(o.currency, slot);
  }
  return [...map.entries()].map(([currency, slot]) => ({ currency, ...slot }));
}

function positionLine(youOwe: string, owedToYou: string, netFormatted: string, net: bigint): string {
  const sign = net < 0n ? "−" : net > 0n ? "+" : "";
  return `You owe ${youOwe} · You're owed ${owedToYou} · Net ${sign}${netFormatted}`;
}

export function obligationPositionLine(row: CurrencyPosition): string {
  const net = row.owedToYou - row.youOwe;
  const abs = net < 0n ? -net : net;
  return positionLine(
    displayMinorAmount(row.youOwe.toString(), row.currency),
    displayMinorAmount(row.owedToYou.toString(), row.currency),
    displayMinorAmount(abs.toString(), row.currency),
    net,
  );
}

/// Remaining USDC from cached invoices, in six-decimal base units. Settled rows use remaining;
/// registered rows use the original amount. Fully netted rows (remaining 0) drop out.
export function invoiceUsdcPosition(invoices: InvoiceRow[], viewer: string): CurrencyPosition | null {
  const me = viewer.toLowerCase();
  let youOwe = 0n;
  let owedToYou = 0n;
  for (const inv of invoices) {
    const decimal = inv.status === "settled" ? (inv.remainingUsdc ?? "0") : inv.amountUsdc;
    const remaining = usdcBaseUnits(decimal) ?? 0n;
    if (remaining === 0n) continue;
    if (inv.debtor.toLowerCase() === me) youOwe += remaining;
    else if (inv.creditor.toLowerCase() === me) owedToYou += remaining;
  }
  if (youOwe === 0n && owedToYou === 0n) return null;
  return { currency: "USDC", youOwe, owedToYou };
}

/// USDC invoices are six-decimal, which Intl doesn't know, so this line uses the USDC formatter
/// rather than the ISO-4217 obligation formatter.
export function invoiceUsdcPositionLine(row: CurrencyPosition): string {
  const net = row.owedToYou - row.youOwe;
  const abs = net < 0n ? -net : net;
  const usdc = (n: bigint) => formatUsdc(n);
  return positionLine(usdc(row.youOwe), usdc(row.owedToYou), usdc(abs), net);
}

export function obligationStatusLabel(o: {
  status: ObligationStatus;
  remaining: string;
  amount: string;
  currency: string;
}): string {
  if (o.status === "closed") return "Closed";
  if (o.status === "out_of_sync") return "out of sync";
  if (o.remaining === o.amount) return "Active · can be netted";
  return `Netted · ${displayMinorAmount(o.remaining, o.currency)} remaining`;
}
