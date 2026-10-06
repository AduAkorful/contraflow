/// Per-currency remaining across a party's active obligations. Closed and out-of-sync rows are
/// excluded; remaining is summed in minor units as BigInt, never as a float.

import { displayMinorAmount } from "../../components/netting/format";
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

export function obligationPositionLine(row: CurrencyPosition): string {
  const net = row.owedToYou - row.youOwe;
  const sign = net < 0n ? "−" : net > 0n ? "+" : "";
  const abs = net < 0n ? -net : net;
  return `You owe ${displayMinorAmount(row.youOwe.toString(), row.currency)} · You're owed ${displayMinorAmount(row.owedToYou.toString(), row.currency)} · Net ${sign}${displayMinorAmount(abs.toString(), row.currency)}`;
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
