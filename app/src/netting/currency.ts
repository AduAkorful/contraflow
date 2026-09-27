/// ISO 4217 codes and minor units, from the runtime's own `Intl` data so there's no currency
/// table to keep in sync. Amounts on an obligation are integers in minor units (cents for USD,
/// yen for JPY, fils for KWD), so parsing and formatting never touch floating point.

export class CurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrencyError";
  }
}

const CODE_PATTERN = /^[A-Z]{3}$/;
const AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export function isIsoCurrency(code: string): boolean {
  if (!CODE_PATTERN.test(code)) return false;
  if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("currency").includes(code);
  return true;
}

export function minorUnits(code: string): number {
  if (!isIsoCurrency(code)) throw new CurrencyError(`Not an ISO 4217 currency code: ${JSON.stringify(code)}`);
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
    .maximumFractionDigits;
  if (digits === undefined) throw new CurrencyError(`No minor-unit data for ${code}`);
  return digits;
}

/// `parseAmount("1250.00", "USD")` is `125000n`. Rejects signs, grouping separators, exponents
/// and more decimal places than the currency has.
export function parseAmount(input: string, code: string): bigint {
  const units = minorUnits(code);
  const match = AMOUNT_PATTERN.exec(input.trim());
  if (!match) throw new CurrencyError(`Not a plain decimal amount: ${JSON.stringify(input)}`);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > units) {
    throw new CurrencyError(`${code} has ${units} decimal place${units === 1 ? "" : "s"}, got ${fraction.length}`);
  }
  return BigInt(whole + fraction.padEnd(units, "0"));
}

/// `formatAmount(125000n, "USD")` is `"1250.00"`: plain digits, no grouping or symbol, so it
/// round-trips through `parseAmount`.
export function formatAmount(amount: bigint, code: string): string {
  if (amount < 0n) throw new CurrencyError("Amounts are never negative");
  const units = minorUnits(code);
  if (units === 0) return amount.toString();
  const digits = amount.toString().padStart(units + 1, "0");
  return `${digits.slice(0, -units)}.${digits.slice(-units)}`;
}
