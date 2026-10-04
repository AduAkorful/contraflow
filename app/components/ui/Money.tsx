import { formatUsdcDisplay } from "../../src/attest/amount";
import { formatUsdcNumber } from "../../src/format/money";

/// The one way to print a USDC amount: grouped, exact, tabular numerals. Takes a decimal string or
/// six-decimal base units. `unit={false}` drops the "USDC" suffix where a heading already says it.
export function Money({ value, unit = true, className }: { value: string | bigint; unit?: boolean; className?: string }) {
  const number = formatUsdcNumber(typeof value === "bigint" ? formatUsdcDisplay(value) : value);
  return <span className={["tabular-nums", className].filter(Boolean).join(" ")}>{unit ? `${number} USDC` : number}</span>;
}
