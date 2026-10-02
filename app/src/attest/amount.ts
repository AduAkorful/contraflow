/// Exact USDC decimal conversion for the six-decimal ERC-20 settlement asset. Keep amount input,
/// canonical document text and EIP-712 base units derived from this one parser/formatter.

const USDC_BASE_UNITS = 1_000_000n;
const MAX_UINT256 = (1n << 256n) - 1n;
const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export class UsdcAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsdcAmountError";
  }
}

export function parseUsdcAmount(input: string): bigint {
  if (typeof input !== "string" || input.length > 80) {
    throw new UsdcAmountError("Enter a valid USDC amount.");
  }
  const match = PLAIN_DECIMAL.exec(input.trim());
  if (!match) throw new UsdcAmountError("Enter a plain decimal amount without signs or exponent notation.");

  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > 6) throw new UsdcAmountError("USDC supports at most 6 decimal places.");

  const baseUnits = BigInt(whole) * USDC_BASE_UNITS + BigInt(fraction.padEnd(6, "0") || "0");
  if (baseUnits === 0n) throw new UsdcAmountError("Amount must be greater than zero.");
  if (baseUnits > MAX_UINT256) throw new UsdcAmountError("Amount exceeds the contract's uint256 limit.");
  return baseUnits;
}

/// Formats a positive base-unit amount without losing precision. Preserve cents for ordinary
/// amounts while showing additional non-zero micro-USDC digits when the invoice uses them.
export function formatUsdcAmount(baseUnits: bigint): string {
  if (baseUnits <= 0n || baseUnits > MAX_UINT256) {
    throw new UsdcAmountError("USDC amount is outside the contract's positive uint256 range.");
  }
  return formatUsdcDisplay(baseUnits);
}

/// Exact display formatter also permits a zero remaining balance for receipts/history.
export function formatUsdcDisplay(baseUnits: bigint): string {
  if (baseUnits < 0n) throw new UsdcAmountError("USDC amount cannot be negative.");
  const whole = baseUnits / USDC_BASE_UNITS;
  const fraction = (baseUnits % USDC_BASE_UNITS).toString().padStart(6, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}.${trimmed.padEnd(2, "0")}`;
}
