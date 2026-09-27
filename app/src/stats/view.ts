/// Turns a `StatsState` into exactly what the stats block renders. Wording lives here, not in the
/// component, so the copy rules are tested: "netted" and "settled" only, never "extinguished",
/// "paid" or "discharged", and no "+" or "over" rounding.

import { blockscoutBaseFor } from "../blockscout/client";
import { ARC_MAINNET_CHAIN_ID } from "../contracts/addresses";
import type { StatsState } from "./aggregate";
import { asLowerBound, formatAsOf, formatCount, formatDate, formatGas, formatUsdc, type Formatted } from "./format";

export interface StatTile extends Formatted {
  label: string;
  note?: string;
}

export interface StatsView {
  chainName: string;
  asOf: string;
  since: string | null;
  headline: StatTile[];
  detail: StatTile[];
  demoNote: string | null;
  lowerBound: boolean;
  contracts: { label: string; url: string }[];
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export function buildStatsView(state: StatsState, contracts: { registry: string; settler: string; ledger: string }): StatsView {
  const { totals, demo, lowerBound } = state;
  const bound = (f: Formatted) => asLowerBound(f, lowerBound);
  const loops = totals.invoiceLoopsSettled + totals.certificatesApplied;
  const explorer = blockscoutBaseFor(state.chainId);

  const headline: StatTile[] = [
    { label: "Invoices registered", ...bound(formatCount(totals.invoicesRegistered)) },
    { label: "Value netted", ...bound(formatUsdc(totals.valueNetted)) },
    {
      label: "Loops settled",
      ...bound(formatCount(loops)),
      note: `${plural(totals.invoiceLoopsSettled, "invoice loop", "invoice loops")} · ${plural(totals.certificatesApplied, "certificate", "certificates")}`,
    },
    {
      label: "USDC moved by settlement",
      value: "0 USDC",
      exact: "0 USDC",
      note: "Settlement reduces balances in place. Neither contract transfers tokens.",
    },
  ];

  const detail: StatTile[] = [
    { label: "Face value registered", ...bound(formatUsdc(totals.faceValueRegistered)) },
    { label: "Invoices fully netted", ...bound(formatCount(totals.fullyNetted)) },
    { label: "Parties", ...bound(formatCount(state.parties.length)), note: "Distinct invoice debtors and creditors" },
    { label: "Gas paid for settlement", ...bound(formatGas(totals.gasPaidWei)), note: "Native USDC" },
    {
      label: "Obligation updates",
      ...bound(formatCount(totals.obligationUpdates)),
      note: "Offchain obligations. Amounts stay offchain, so only counts are shown.",
    },
  ];

  const demoNote =
    demo.invoicesRegistered + demo.loopsSettled > 0
      ? `Plus ${plural(demo.invoicesRegistered, "invoice", "invoices")} and ${plural(demo.loopsSettled, "loop", "loops")} sent from Contraflow's operator wallet (the live demo and our own test runs), not counted above.`
      : null;

  return {
    chainName: state.chainId === ARC_MAINNET_CHAIN_ID ? "Arc" : "Arc testnet",
    asOf: formatAsOf(state.updatedAt),
    since: state.firstEventAt ? formatDate(state.firstEventAt) : null,
    headline,
    detail,
    demoNote,
    lowerBound,
    contracts: [
      { label: "Registry", url: `${explorer}/address/${contracts.registry}` },
      { label: "Settler", url: `${explorer}/address/${contracts.settler}` },
      { label: "Netting ledger", url: `${explorer}/address/${contracts.ledger}` },
    ],
  };
}
