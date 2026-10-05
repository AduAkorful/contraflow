import { usdcBaseUnits } from "./money";

export type NettingStatus = "open" | "partly" | "fully";

export const NETTING_STATUS_LABEL: Record<NettingStatus, string> = {
  open: "Open",
  partly: "Partly netted",
  fully: "Fully netted",
};

/// Where an invoice stands after any settlements. Never "cancelled" for a partial reduction: only an
/// invoice with nothing left to pay is fully netted. Amounts that can't be read exactly are "open",
/// the state that claims least.
export function nettingStatus(amountUsdc: string, remainingUsdc: string | null): NettingStatus {
  if (remainingUsdc === null) return "open";
  const amount = usdcBaseUnits(amountUsdc);
  const remaining = usdcBaseUnits(remainingUsdc);
  if (amount === null || remaining === null) return "open";
  if (remaining === 0n) return "fully";
  return remaining < amount ? "partly" : "open";
}
