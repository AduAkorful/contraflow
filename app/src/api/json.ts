/// JSON for API responses: bigints become decimal strings so clients can round-trip amounts.

export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
