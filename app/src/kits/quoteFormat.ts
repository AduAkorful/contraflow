/// Browser-safe helpers for the EURC quote: the feature flag and display rounding. Kept apart from
/// `quote.ts`, which is server-only and pulls in App Kit.

export interface EurcQuote {
  /// Exactly what was quoted, as a decimal string: the invoice's live remaining amount.
  amountInUsdc: string;
  /// Swap Kit's own `estimatedOutput.amount`, unmodified.
  estimatedOutputEurc: string;
  /// Human-readable chain name the quote was taken on, e.g. "Arc Testnet".
  chainLabel: string;
  /// ISO timestamp of when Swap Kit returned this quote (a cached quote keeps its original time).
  quotedAt: string;
}

export type EurcQuoteResult =
  | { ok: true; quote: EurcQuote }
  | { ok: false; reason: "nothing_remaining" | "not_found" | "rate_limited" | "unavailable" };

/// On unless explicitly switched off, so the quote (a Phase 1 deliverable) never disappears because
/// an environment forgot to set a variable. `off` hides every quote button.
export function eurcQuoteEnabled(flag: string | undefined = process.env.NEXT_PUBLIC_FEATURE_EURC_QUOTE): boolean {
  return flag?.trim().toLowerCase() !== "off";
}

/// Rounds a non-negative decimal string half-up to `places` using integer arithmetic, so display
/// rounding never picks up float error. Returns the input unchanged if it isn't a plain decimal.
export function roundDecimalString(value: string, places: number): string {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return value;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const scale = 10n ** BigInt(places);
  const kept = BigInt(whole) * scale + BigInt((fraction + "0".repeat(places)).slice(0, places) || "0");
  const roundUp = (fraction[places] ?? "0") >= "5";
  const rounded = kept + (roundUp ? 1n : 0n);
  if (places === 0) return rounded.toString();
  const digits = rounded.toString().padStart(places + 1, "0");
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/// "14:05 UTC" from an ISO timestamp.
export function formatQuoteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}
