/// Browser-safe, pure helpers for Gateway balances and fees, shared by the operator's server-side
/// wrappers and the user's `/app/balance` page. Amounts stay decimal strings at the App Kit
/// boundary; any arithmetic here is done in USDC base units (6 decimals), never floats.

import { formatUnits, parseUnits } from "viem";

import { findGatewayChain, type GatewayChain } from "./gatewayChains";

const USDC_DECIMALS = 6;

/// The subset of App Kit's `GetBalancesResult` this module reads. `chain` is typed `Blockchain` in
/// the SDK while requests take `UnifiedBalanceChain`; the runtime strings are the same, so chains
/// are always compared as strings.
export interface GatewayBalancesLike {
  totalConfirmedBalance: string;
  totalPendingBalance?: string;
  breakdown: {
    breakdown: { chain: unknown; confirmedBalance: string; pendingBalance?: string }[];
  }[];
}

export interface GatewayBalanceRow {
  chain: string;
  /// Known to this app as a source (or Arc itself); `undefined` for a chain the page can't act on.
  known: GatewayChain | undefined;
  confirmed: string;
  pending: string;
}

export interface GatewayBalanceView {
  totalConfirmed: string;
  totalPending: string;
  rows: GatewayBalanceRow[];
}

export function toBaseUnits(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}

export function fromBaseUnits(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

function safeBaseUnits(amount: string | undefined): bigint {
  if (!amount) return 0n;
  try {
    return toBaseUnits(amount);
  } catch {
    return 0n;
  }
}

/// Per chain, summed across depositor entries. Only chains holding something (confirmed or
/// pending) are returned, largest confirmed first.
export function parseGatewayBalances(result: GatewayBalancesLike, arcChainId: number): GatewayBalanceView {
  const byChain = new Map<string, { confirmed: bigint; pending: bigint }>();
  for (const account of result.breakdown) {
    for (const entry of account.breakdown) {
      const chain = String(entry.chain);
      const current = byChain.get(chain) ?? { confirmed: 0n, pending: 0n };
      current.confirmed += safeBaseUnits(entry.confirmedBalance);
      current.pending += safeBaseUnits(entry.pendingBalance);
      byChain.set(chain, current);
    }
  }

  const rows = [...byChain.entries()]
    .filter(([, v]) => v.confirmed > 0n || v.pending > 0n)
    .sort(([, a], [, b]) => (a.confirmed === b.confirmed ? 0 : a.confirmed > b.confirmed ? -1 : 1))
    .map(([chain, v]) => ({
      chain,
      known: findGatewayChain(arcChainId, chain),
      confirmed: fromBaseUnits(v.confirmed),
      pending: fromBaseUnits(v.pending),
    }));

  return {
    totalConfirmed: fromBaseUnits(safeBaseUnits(result.totalConfirmedBalance)),
    totalPending: fromBaseUnits(safeBaseUnits(result.totalPendingBalance)),
    rows,
  };
}

/// Confirmed balance on one chain, in base units.
export function confirmedOn(result: GatewayBalancesLike, chain: string): bigint {
  let total = 0n;
  for (const account of result.breakdown) {
    for (const entry of account.breakdown) {
      if (String(entry.chain) === chain) total += safeBaseUnits(entry.confirmedBalance);
    }
  }
  return total;
}

export interface FeeLine {
  type: string;
  token: string;
  amount: string;
}

/// Sum of the USDC-denominated fees, in base units. Fees in other tokens (a deposit's native gas)
/// are shown separately and never added to USDC.
export function usdcFeeTotal(fees: readonly FeeLine[]): bigint {
  return fees.filter((f) => f.token === "USDC").reduce((sum, f) => sum + safeBaseUnits(f.amount), 0n);
}

const FEE_LABELS: Record<string, string> = {
  provider: "Circle Gateway fee",
  gasFee: "Network fee",
  forwarder: "Delivery to Arc",
  kit: "Kit fee",
};

export function feeLabel(type: string): string {
  return FEE_LABELS[type] ?? "Fee";
}

export type AmountCheck = { ok: true; amount: string; baseUnits: bigint } | { ok: false; error: string };

/// Validates a user-typed USDC amount: a plain positive decimal with at most 6 places, and no more
/// than `maxBaseUnits` when given.
export function checkUsdcAmount(input: string, maxBaseUnits?: bigint): AmountCheck {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return { ok: false, error: "Enter an amount like 25 or 25.50." };
  const baseUnits = toBaseUnits(trimmed);
  if (baseUnits === 0n) return { ok: false, error: "Enter an amount above zero." };
  if (maxBaseUnits !== undefined && baseUnits > maxBaseUnits) {
    return { ok: false, error: `That's more than the ${fromBaseUnits(maxBaseUnits)} USDC available.` };
  }
  return { ok: true, amount: fromBaseUnits(baseUnits), baseUnits };
}
