/// A party's netting rules. With the allowlist on, a loop is allowed for that party only when
/// every other member is one of its approved addresses. Pure: storage and enforcement are
/// elsewhere. Rules apply to every party in a loop, not only the one searching or signing.

import { getAddress, isAddress, type Address } from "viem";

export const MAX_ALLOWED_COUNTERPARTIES = 50;

export interface PartyRules {
  enabled: boolean;
  /// Lowercased addresses.
  allowed: string[];
}

export type RulesByParty = ReadonlyMap<string, PartyRules>;

export const NO_RULES: PartyRules = { enabled: false, allowed: [] };

/// The first party in `loop` whose allowlist rejects another member, or null if every party's rules
/// are satisfied.
export function loopRejectedBy(loop: readonly string[], rules: RulesByParty): string | null {
  const members = [...new Set(loop.map((a) => a.toLowerCase()))];
  for (const party of members) {
    const rule = rules.get(party);
    if (!rule?.enabled) continue;
    const allowed = new Set(rule.allowed);
    if (members.some((other) => other !== party && !allowed.has(other))) return party;
  }
  return null;
}

export type ParsedAllowlist = { ok: true; addresses: string[] } | { ok: false; error: string };

/// Addresses separated by whitespace, commas or semicolons. Own address is dropped, duplicates
/// collapse, and anything that isn't an address refuses the whole list rather than guessing.
export function parseAllowlist(input: unknown, own: Address): ParsedAllowlist {
  if (typeof input !== "string") return { ok: false, error: "The list must be text." };
  const tokens = input.split(/[\s,;]+/).filter((t) => t.length > 0);
  const out = new Set<string>();
  for (const token of tokens) {
    if (!isAddress(token, { strict: false })) return { ok: false, error: `"${token.slice(0, 12)}…" isn't an address.` };
    const lower = getAddress(token).toLowerCase();
    if (lower !== own.toLowerCase()) out.add(lower);
  }
  if (out.size > MAX_ALLOWED_COUNTERPARTIES) {
    return { ok: false, error: `Keep the list to ${MAX_ALLOWED_COUNTERPARTIES} addresses or fewer.` };
  }
  return { ok: true, addresses: [...out].sort() };
}
