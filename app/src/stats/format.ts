/// Number formatting for protocol stats. Every compact figure also gets an exact form for the
/// element's title and accessible name, so rounding is never the only thing a reader can see.

import { formatUnits } from "viem";

const COMPACT_FROM = 10_000;
const USDC_DECIMALS = 6;
const NATIVE_USDC_DECIMALS = 18;

export interface Formatted {
  value: string;
  exact: string;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function groupDecimal(decimal: string, minFraction: number): string {
  const [whole = "0", fraction = ""] = decimal.split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  const padded = fraction.replace(/0+$/, "").padEnd(minFraction, "0");
  return padded ? `${grouped}.${padded}` : grouped;
}

export function formatCount(n: number): Formatted {
  const exact = n.toLocaleString("en-US");
  return { value: n >= COMPACT_FROM ? compact.format(n) : exact, exact };
}

/// ERC-20 USDC base units (6 decimals).
export function formatUsdc(baseUnits: string): Formatted {
  const decimal = formatUnits(BigInt(baseUnits), USDC_DECIMALS);
  const exact = `${groupDecimal(decimal, 2)} USDC`;
  const n = Number(decimal);
  if (n >= COMPACT_FROM) return { value: `${compact.format(n)} USDC`, exact };
  const rounded = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { value: `${rounded} USDC`, exact };
}

/// Native USDC wei (18 decimals). Gas totals are small, so they keep significant digits instead.
export function formatGas(wei: string): Formatted {
  const decimal = formatUnits(BigInt(wei), NATIVE_USDC_DECIMALS);
  const exact = `${groupDecimal(decimal, 0)} USDC`;
  const n = Number(decimal);
  if (n === 0) return { value: "0 USDC", exact: "0 USDC" };
  const value = n < 1 ? n.toLocaleString("en-US", { maximumSignificantDigits: 3 }) : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return { value: `${value} USDC`, exact };
}

export function asLowerBound(f: Formatted, lowerBound: boolean): Formatted {
  return lowerBound ? { value: `At least ${f.value}`, exact: `At least ${f.exact}` } : f;
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatAsOf(iso: string): string {
  return `${dateTime.format(new Date(iso))} UTC`;
}

export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}
