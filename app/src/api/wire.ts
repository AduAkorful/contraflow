/// API wire amounts and timestamps. List responses use `amountMinor` (an integer string in the
/// currency's minor units) plus `amountDisplay` (the same amount in major units, plain digits).
/// Timestamps are unix-second strings. The signed obligation document and its EIP-712 fields keep
/// their own names: those are the hash the parties and the ledger already use.

import { formatAmount, parseAmount } from "../netting/currency";

export function amountFieldsFromMinor(minor: string, currency: string): { amountMinor: string; amountDisplay: string } {
  return { amountMinor: minor, amountDisplay: formatAmount(BigInt(minor), currency) };
}

export function amountFieldsFromMajor(major: string, currency: string): { amountMinor: string; amountDisplay: string } {
  return { amountMinor: parseAmount(major, currency).toString(), amountDisplay: major.trim() };
}

/// An ISO timestamp or a unix-second string, as unix seconds. Anything else is refused.
export function unixSeconds(value: string | Date): string {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000).toString();
  if (/^\d+$/.test(value)) return value;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Not a timestamp: ${value}`);
  return Math.floor(ms / 1000).toString();
}

/// JSON number. Chain ids here are Arc's, well inside the safe integer range.
export function apiChainId(value: string | number | bigint): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`Not a chain id: ${String(value)}`);
  return n;
}
