/// Turns stored stats into exactly what the stats block renders. Wording lives here, not in the
/// component, so the copy rules are tested: "netted" and "settled" only, never "extinguished",
/// "paid" or "discharged", and no "+" or "over" rounding.

import { blockscoutBaseFor } from "../blockscout/client";
import { ARC_MAINNET_CHAIN_ID } from "../contracts/addresses";
import { isCaughtUp, type StatsState } from "./aggregate";
import { formatAsOf, formatCount, formatDate, formatUpdated, formatUsdc, type Formatted } from "./format";

export interface StatTile extends Formatted {
  label: string;
  note?: string;
}

export interface StatsView {
  chainName: string;
  asOf: string;
  /// Short form for the line under the card: "16:53 UTC", or with the date when not today.
  updated: string;
  since: string | null;
  headline: StatTile[];
  detail: StatTile[];
  /// Set when the figures are behind: still backfilling, older than the threshold, or the last
  /// refresh failed. Shown prominently; the figures are still true as of `asOf`.
  staleness: string | null;
  contracts: { label: string; url: string }[];
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export const VALUE_NETTED_NOTE = "USDC invoices only. Certificates are off-chain.";

export function buildStatsView(
  state: StatsState,
  contracts: { registry: string; settler: string; ledger: string },
  opts: { now: Date; staleAfterMs: number; lastError: { message: string; at: string } | null },
): StatsView {
  const { totals } = state;
  const loops = totals.invoiceLoopsSettled + totals.certificatesApplied;
  const explorer = blockscoutBaseFor(state.chainId);

  const headline: StatTile[] = [
    { label: "Invoices registered", ...formatCount(totals.invoicesRegistered) },
    { label: "Value netted", ...formatUsdc(totals.valueNetted), note: VALUE_NETTED_NOTE },
    {
      label: "Loops settled",
      ...formatCount(loops),
      note: `${plural(totals.invoiceLoopsSettled, "invoice loop", "invoice loops")} · ${plural(totals.certificatesApplied, "certificate", "certificates")} · no tokens move`,
    },
  ];

  const detail: StatTile[] = [
    { label: "Face value registered", ...formatUsdc(totals.faceValueRegistered) },
    { label: "Invoices fully netted", ...formatCount(totals.fullyNetted) },
    { label: "Parties", ...formatCount(state.parties.length), note: "Distinct invoice debtors and creditors" },
    {
      label: "Obligation updates",
      ...formatCount(totals.obligationUpdates),
      note: "Offchain obligations. Amounts stay offchain, so only counts are shown.",
    },
  ];

  let staleness: string | null = null;
  const age = opts.now.getTime() - Date.parse(state.updatedAt);
  if (!isCaughtUp(state)) {
    const start = BigInt(state.startBlock);
    const span = BigInt(state.headBlock) - start + 1n;
    const done = BigInt(state.cursorBlock) - start + 1n;
    const pct = span > 0n ? Number((done * 100n) / span) : 0;
    staleness = `Still counting from the chain (${pct}% done). These figures are incomplete.`;
  } else if (age > opts.staleAfterMs) {
    staleness = `Not updated for ${Math.round(age / 60_000)} minutes. Figures are as of the time below.`;
  }
  if (opts.lastError && Date.parse(opts.lastError.at) >= Date.parse(state.updatedAt)) {
    staleness = `${staleness ?? "The latest update failed."} Retrying automatically.`;
  }

  return {
    chainName: state.chainId === ARC_MAINNET_CHAIN_ID ? "Arc" : "Arc testnet",
    asOf: formatAsOf(state.updatedAt),
    updated: formatUpdated(state.updatedAt, opts.now),
    since: state.firstEventAt ? formatDate(state.firstEventAt) : null,
    headline,
    detail,
    staleness,
    contracts: [
      { label: "Registry", url: `${explorer}/address/${contracts.registry}` },
      { label: "Settler", url: `${explorer}/address/${contracts.settler}` },
      { label: "Netting ledger", url: `${explorer}/address/${contracts.ledger}` },
    ],
  };
}
