/// Plain-language names for the certificate verifier's named checks, and the short grouped
/// summary a party sees before signing. Facts, not verdicts: each line says what was checked.

import type { CheckStatus, VerificationCheck } from "../../src/netting/verify";

const ENTRY_CHECKS: Record<string, string> = {
  "obligation-id": "matches the obligation both parties signed",
  parties: "names the right debtor and creditor",
  "obligation-signatures": "carries both parties' signatures",
  currency: "is in the certificate's currency",
  "prior-commitment": "starts from its recorded state",
  amounts: "reduces by exactly the netted amount",
  "next-commitment": "commits to its new state",
  maturity: "is due, or both parties agreed to net it early",
};

/// "entry:1:amounts" → "Obligation 2 reduces by exactly the netted amount".
export function describeCheck(name: string): string {
  const entry = /^entry:(\d+):(.+)$/.exec(name);
  if (entry) return `Obligation ${Number(entry[1]) + 1} ${ENTRY_CHECKS[entry[2]!] ?? entry[2]}`;
  const signature = /^certificate-signature:(\d+)$/.exec(name);
  if (signature) return `Party ${Number(signature[1]) + 1} signed this certificate`;
  const state = /^onchain:entry:(\d+):state$/.exec(name);
  if (state) return `Obligation ${Number(state[1]) + 1}'s state on the ledger`;
  return (
    {
      "view.shape": "The file is a well-formed certificate",
      chain: "The certificate is for this network",
      "certificate.loop": "The obligations form a closed loop, each party once",
      "view.coverage": "At least one obligation is held in full",
      "view.own-entries": "Both of your obligations are held in full",
      "content-hash": "The contents match the hash every party signed",
      onchain: "The ledger was read",
      "onchain:applied": "The ledger has applied this certificate",
      "ledger:current": "Each obligation's recorded state is still current on the ledger",
      verifier: "The verifier finished",
    }[name] ?? name
  );
}

export interface CheckGroup {
  label: string;
  status: CheckStatus;
}

const GROUPS: { label: string; matches: (name: string) => boolean }[] = [
  {
    label: "Your obligations are unchanged",
    matches: (n) =>
      n === "view.own-entries" || /^entry:\d+:(obligation-id|parties|obligation-signatures|currency|maturity)$/.test(n),
  },
  { label: "Amounts add up", matches: (n) => /^entry:\d+:(prior-commitment|amounts|next-commitment)$/.test(n) || n === "content-hash" },
  { label: "Loop is closed", matches: (n) => ["view.shape", "chain", "certificate.loop", "view.coverage", "verifier"].includes(n) },
  { label: "Signed by every party", matches: (n) => n.startsWith("certificate-signature:") },
  { label: "Ledger state is current", matches: (n) => n === "ledger:current" },
];

function combined(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("unverifiable")) return "unverifiable";
  return "pass";
}

/// The short list shown on a certificate. Every check lands in exactly one group, so nothing is
/// dropped; a group with no checks isn't shown.
export function groupChecks(checks: VerificationCheck[]): CheckGroup[] {
  const groups: CheckGroup[] = [];
  const placed = new Set<VerificationCheck>();
  for (const group of GROUPS) {
    const members = checks.filter((c) => group.matches(c.name));
    members.forEach((c) => placed.add(c));
    if (members.length > 0) groups.push({ label: group.label, status: combined(members.map((c) => c.status)) });
  }
  const rest = checks.filter((c) => !placed.has(c));
  if (rest.length > 0) groups.push({ label: "Other checks", status: combined(rest.map((c) => c.status)) });
  return groups;
}

export function statusMark(status: CheckStatus): string {
  return status === "pass" ? "✓" : status === "fail" ? "✕" : "?";
}
