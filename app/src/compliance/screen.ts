/// Address pre-screening (spec §4.1 FR-1.3, §6). Application-layer only — Arc validators do not
/// screen senders, and no contract in this repo gains compliance logic because of this module.
/// Never imported by `ContraflowSettler`/`ContraflowRegistry`. See `plans/08-compliance-prescreen.md`.

import type { Address } from "viem";
import type { InvoiceEdge } from "@contraflow/solver";

export type ComplianceStatus = "clear" | "flagged";

export interface ScreenResult {
  address: Address;
  status: ComplianceStatus;
  /// Present when `status === "flagged"`.
  reason?: string;
  /// Which provider produced this result — `"stub"`, `"manual-denylist"`, or (later) a real
  /// vendor name, so a flagged result's origin is always traceable.
  provider: string;
}

/// Seam for a real vendor (Compliance Engine, Chainalysis, Elliptic, TRM) later — not implemented
/// in this step, gated behind access this project doesn't have (spec FR-1.3).
export interface ComplianceProvider {
  screenAddress(address: Address): Promise<ScreenResult>;
}

export async function screenAddresses(
  addresses: Address[],
  provider: ComplianceProvider,
): Promise<ScreenResult[]> {
  const deduped = [...new Set(addresses.map((a) => a.toLowerCase()))] as Address[];
  return Promise.all(deduped.map((address) => provider.screenAddress(address)));
}

export interface FilterFlaggedInvoicesResult {
  clearInvoices: InvoiceEdge[];
  flagged: ScreenResult[];
}

/// Drops any invoice whose debtor or creditor screens flagged, before the remaining invoices ever
/// reach `@contraflow/solver`'s `buildGraph`/`proposeSettleCall` — spec: "Flagged addresses are
/// not inserted into the solver graph."
export async function filterFlaggedInvoices(
  invoices: InvoiceEdge[],
  provider: ComplianceProvider,
): Promise<FilterFlaggedInvoicesResult> {
  const allAddresses = invoices.flatMap((inv) => [inv.debtor, inv.creditor]);
  const results = await screenAddresses(allAddresses, provider);

  const flagged = results.filter((r) => r.status === "flagged");
  const flaggedSet = new Set(flagged.map((r) => r.address.toLowerCase()));

  const clearInvoices = invoices.filter(
    (inv) => !flaggedSet.has(inv.debtor.toLowerCase()) && !flaggedSet.has(inv.creditor.toLowerCase()),
  );

  return { clearInvoices, flagged };
}
