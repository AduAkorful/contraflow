import { formatUsdcDisplay } from "../attest/amount";

const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

function groupThousands(whole: string): string {
  return whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/// "2650.5" → "2,650.50". Works on the decimal string directly, so no float rounding: at least two
/// decimals, and any further non-zero micro-USDC digits are kept. A value that isn't a plain decimal
/// (legacy rows) is shown as stored instead of being reinterpreted.
export function formatUsdcNumber(decimal: string): string {
  const match = PLAIN_DECIMAL.exec(decimal.trim());
  if (!match) return decimal;
  const fraction = (match[2] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${groupThousands(match[1]!)}.${fraction}`;
}

/// "2,650.00 USDC" from a decimal string or six-decimal base units.
export function formatUsdc(value: string | bigint): string {
  const decimal = typeof value === "bigint" ? formatUsdcDisplay(value) : value;
  return `${formatUsdcNumber(decimal)} USDC`;
}

/// Six-decimal base units of a plain decimal string, or null when it isn't one.
export function usdcBaseUnits(decimal: string): bigint | null {
  const match = PLAIN_DECIMAL.exec(decimal.trim());
  if (!match || (match[2] ?? "").length > 6) return null;
  return BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}

/// Exact sum of decimal USDC strings (at most six decimals each), returned as a decimal string.
export function sumUsdc(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    const match = PLAIN_DECIMAL.exec(value.trim());
    if (!match || (match[2] ?? "").length > 6) throw new Error(`Not a USDC decimal amount: ${value}`);
    total += BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  }
  return formatUsdcDisplay(total);
}
