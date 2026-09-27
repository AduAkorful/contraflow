/// Pure derivation of the cycle inspector's signals from an address's raw explorer activity. These
/// are facts, never verdicts: nothing here scores or labels a party, and every value derived from
/// a page-bounded list carries a flag saying so, so the UI can phrase it as a lower bound instead
/// of presenting a truncated view as complete.

import type { AddressTokenTransfer, AddressTransaction, BoundedList } from "../blockscout/client";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface KnownAddresses {
  registry: string;
  settler: string;
  usdc: string;
  /// Contraflow's operator wallet, which sends the starter grant (and has funded other wallets,
  /// so funding from it is labeled as the operator, never assumed to be a grant). Null when the
  /// operator key isn't configured — its funding then shows as a plain address.
  operator: string | null;
}

export interface AddressActivity {
  address: string;
  isContract: boolean;
  transactions: BoundedList<AddressTransaction>;
  transfers: BoundedList<AddressTokenTransfer>;
  /// Timestamp of the earliest invoice naming this address. Only looked up when the address has
  /// no activity of its own (a party that only ever signs).
  firstInvoiceAt: string | null;
}

export type FirstSeen =
  | { kind: "exact"; at: string }
  | { kind: "onOrBefore"; at: string }
  | { kind: "invoiceOnly"; at: string }
  | { kind: "never" };

export type Funder =
  | { kind: "operator" }
  | { kind: "mint" }
  | { kind: "address"; address: string }
  | { kind: "none" };

export interface AddressSignals {
  address: string;
  accountType: "contract" | "eoa";
  firstSeen: FirstSeen;
  outsideActivity: { count: number; lowerBound: boolean };
  firstFunder: Funder;
  /// True when the transfer list was truncated, so the earliest funder found may not be the first.
  firstFunderLowerBound: boolean;
  /// Earliest incoming funder that is a third party — operator funding and bridge-in mints are
  /// skipped, since every real-mode party's starter grant comes from the former and every
  /// bridged-in party shares the latter.
  /// Lowercased; null if there is none.
  matchingFunder: string | null;
}

export interface CycleSignals {
  parties: AddressSignals[];
  /// Invoices in the settled cycle. Can exceed `parties.length` if an invoice's registration lies
  /// beyond the explorer log scan bound, in which case the panel says how many parties it covers.
  cycleLength: number;
  /// Spread between the earliest and latest party first-seen times. `approximate` when any party's
  /// time is a lower bound or an invoice-appearance fallback, or when a party has no time at all.
  firstSeenSpread: { ms: number; approximate: boolean } | null;
  sharedFunder: { address: string; count: number } | null;
  contraflowOnlyCount: number;
  registerToSettleMs: number | null;
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function firstSeenOf(activity: AddressActivity): FirstSeen {
  const stamps = [
    ...activity.transactions.items.map((t) => t.timestamp),
    ...activity.transfers.items.map((t) => t.timestamp),
  ];
  if (stamps.length === 0) {
    return activity.firstInvoiceAt ? { kind: "invoiceOnly", at: activity.firstInvoiceAt } : { kind: "never" };
  }
  const earliest = stamps.reduce((min, s) => (toMs(s) < toMs(min) ? s : min));
  const truncated = activity.transactions.truncated || activity.transfers.truncated;
  return truncated ? { kind: "onOrBefore", at: earliest } : { kind: "exact", at: earliest };
}

function isContraflowTransaction(tx: AddressTransaction, address: string, known: KnownAddresses): boolean {
  if (same(tx.to, known.registry) || same(tx.to, known.settler)) return true;
  // Operator funding (the starter grant) arrives as a plain value transfer.
  return same(tx.from, known.operator) && same(tx.to, address);
}

function classifyFunder(from: string, known: KnownAddresses): Funder {
  if (same(from, ZERO_ADDRESS)) return { kind: "mint" };
  if (same(from, known.operator)) return { kind: "operator" };
  return { kind: "address", address: from };
}

export function addressSignals(activity: AddressActivity, known: KnownAddresses): AddressSignals {
  const { address } = activity;

  const outside = activity.transactions.items.filter((tx) => !isContraflowTransaction(tx, address, known));

  // Lists arrive newest-first; reverse before a stable sort so same-second transfers keep their
  // on-chain order.
  const incoming = activity.transfers.items
    .filter((t) => same(t.to, address) && !same(t.from, address) && same(t.token, known.usdc))
    .reverse()
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

  const funders = incoming.map((t) => classifyFunder(t.from, known));
  const firstThirdParty = funders.find((f): f is { kind: "address"; address: string } => f.kind === "address");

  return {
    address,
    accountType: activity.isContract ? "contract" : "eoa",
    firstSeen: firstSeenOf(activity),
    outsideActivity: { count: outside.length, lowerBound: activity.transactions.truncated },
    firstFunder: funders[0] ?? { kind: "none" },
    firstFunderLowerBound: activity.transfers.truncated,
    matchingFunder: firstThirdParty ? firstThirdParty.address.toLowerCase() : null,
  };
}

export function isContraflowOnly(signals: AddressSignals): boolean {
  return signals.outsideActivity.count === 0 && !signals.outsideActivity.lowerBound;
}

function firstSeenSpread(parties: AddressSignals[]): CycleSignals["firstSeenSpread"] {
  const timed = parties.filter(
    (p): p is AddressSignals & { firstSeen: { at: string } } => p.firstSeen.kind !== "never",
  );
  if (timed.length < 2) return null;
  const times = timed.map((p) => toMs(p.firstSeen.at));
  const approximate = timed.length < parties.length || timed.some((p) => p.firstSeen.kind !== "exact");
  return { ms: Math.max(...times) - Math.min(...times), approximate };
}

function sharedFunder(parties: AddressSignals[]): CycleSignals["sharedFunder"] {
  const counts = new Map<string, number>();
  for (const p of parties) {
    if (p.matchingFunder) counts.set(p.matchingFunder, (counts.get(p.matchingFunder) ?? 0) + 1);
  }
  let best: { address: string; count: number } | null = null;
  for (const [address, count] of counts) {
    if (count >= 2 && (!best || count > best.count)) best = { address, count };
  }
  return best;
}

export function cycleSignals(
  parties: AddressSignals[],
  cycleLength: number,
  earliestRegisterAt: string | null,
  settleAt: string | null,
): CycleSignals {
  return {
    parties,
    cycleLength,
    firstSeenSpread: firstSeenSpread(parties),
    sharedFunder: sharedFunder(parties),
    contraflowOnlyCount: parties.filter(isContraflowOnly).length,
    registerToSettleMs:
      earliestRegisterAt && settleAt ? Math.max(0, toMs(settleAt) - toMs(earliestRegisterAt)) : null,
  };
}
