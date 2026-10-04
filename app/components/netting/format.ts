import { formatAmount } from "../../src/netting/currency";
import { formatAddress } from "../../src/format/address";

/// Text-only form for sentences and error messages; JSX uses <Address>.
export const shortAddr = formatAddress;

/// "1250.00" in USD → "$1,250.00". Passes the decimal string straight to Intl, which formats it
/// exactly (no float rounding); falls back to "USD 1250.00" on older engines.
export function displayMajorAmount(major: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(major as unknown as number);
  } catch {
    return `${currency} ${major}`;
  }
}

export function displayMinorAmount(minor: string, currency: string): string {
  try {
    return displayMajorAmount(formatAmount(BigInt(minor), currency), currency);
  } catch {
    return `${currency} ${minor}`;
  }
}

/// yyyy-mm-dd or unix seconds → "25 October 2026", in UTC so the date never shifts by timezone.
export function displayDate(value: string): string {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number(value) * 1000;
  return new Date(ms).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
