import { getAddress } from "viem";

/// "0x82d4…1A16": checksummed, 0x plus four characters at each end. An unparseable value is
/// returned unchanged rather than throwing, so a bad row can never break a page.
export function formatAddress(address: string): string {
  let display: string;
  try {
    display = getAddress(address);
  } catch {
    return address;
  }
  return `${display.slice(0, 6)}…${display.slice(-4)}`;
}

/// Full checksummed form for titles, copy and explorer links.
export function checksumAddress(address: string): string {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}
