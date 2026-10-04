/// Plain-language rendering of inspector signals. Kept separate from the components so the exact
/// wording, including every lower-bound phrasing, is unit-tested rather than living in JSX.

import { getAddress, isAddress } from "viem";
import { formatAddress } from "../format/address";
import { MAX_ACTIVITY_PAGES } from "../blockscout/client";
import type { AddressSignals, CycleSignals } from "./signals";

const PAGE_SIZE = 50;
const LIST_BOUND = MAX_ACTIVITY_PAGES * PAGE_SIZE;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/// Signals compare addresses lowercased; anything shown is re-checksummed (EIP-55).
export function displayAddress(address: string): string {
  return isAddress(address, { strict: false }) ? getAddress(address) : address;
}

export const shortAddress = formatAddress;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function formatDuration(ms: number): string {
  if (ms < MINUTE) return "under a minute";
  if (ms < HOUR) return plural(Math.round(ms / MINUTE), "minute");
  if (ms < DAY) return plural(Math.round(ms / HOUR), "hour");
  if (ms < MONTH) return plural(Math.round(ms / DAY), "day");
  if (ms < YEAR) return plural(Math.round(ms / MONTH), "month");
  return plural(Math.round(ms / YEAR), "year");
}

export function describeFirstSeen(s: AddressSignals): string {
  switch (s.firstSeen.kind) {
    case "exact":
      return formatDate(s.firstSeen.at);
    case "onOrBefore":
      return `On or before ${formatDate(s.firstSeen.at)}`;
    case "invoiceOnly":
      return `No transactions of its own. First named in a Contraflow invoice on ${formatDate(s.firstSeen.at)}`;
    case "invoiceOnOrBefore":
      return `No transactions of its own. First named in a Contraflow invoice on or before ${formatDate(s.firstSeen.at)}`;
    case "unknown":
      return "No transactions of its own. The first invoice date could not be determined from the available history";
    case "never":
      return "No onchain activity yet";
  }
}

export function describeOutsideActivity(s: AddressSignals): string {
  const { count, lowerBound } = s.outsideActivity;
  if (lowerBound) {
    return count === 0 ? `None in its latest ${LIST_BOUND} transactions` : `At least ${count}`;
  }
  return count === 0 ? "None" : String(count);
}

export function describeFirstFunder(s: AddressSignals): string {
  const suffix = s.firstFunderLowerBound ? ` (earliest in its latest ${LIST_BOUND} transfers)` : "";
  switch (s.firstFunder.kind) {
    case "operator":
      return `Contraflow's operator wallet, which sends the starter grant${suffix}`;
    case "mint":
      return `USDC minted to this address, e.g. bridged in${suffix}`;
    case "address":
      return `${shortAddress(s.firstFunder.address)}${suffix}`;
    case "none":
      return "No incoming USDC yet";
  }
}

export function describeAccountType(s: AddressSignals): string {
  return s.accountType === "contract" ? "Smart contract" : "Wallet";
}

export interface CycleFact {
  label: string;
  value: string;
  note?: string;
}

export function describeCycle(c: CycleSignals): CycleFact[] {
  const partyCount = c.parties.length;
  const facts: CycleFact[] = [];

  if (c.firstSeenSpread) {
    const { ms, approximate } = c.firstSeenSpread;
    const span = ms < MINUTE ? "a minute" : formatDuration(ms);
    facts.push({
      label: "Parties first seen",
      value: `Within ${approximate ? "about " : ""}${span} of each other`,
    });
  }

  facts.push({
    label: "Shared first funder",
    value: c.sharedFunder
      ? `${c.sharedFunder.lowerBound ? "At least " : ""}${c.sharedFunder.count} of ${partyCount}${c.partiesIncomplete ? " observed" : ""} parties were first funded by ${shortAddress(c.sharedFunder.address)}`
      : c.partiesIncomplete
        ? `No two of the ${partyCount} parties with available records share a first funder`
        : "No two parties share a first funder",
    note: "Funding from Contraflow's operator wallet (the starter grant) and bridged-in USDC isn't counted.",
  });

  facts.push({
    label: "No activity outside Contraflow",
    value: `${c.contraflowOnlyCount} of ${partyCount}${c.partiesIncomplete ? " observed" : ""} parties`,
  });

  if (c.registerToSettleMs !== null) {
    facts.push({ label: "First registration to settlement", value: formatDuration(c.registerToSettleMs) });
  }

  return facts;
}
