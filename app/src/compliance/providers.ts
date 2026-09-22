/// Compliance providers: a stub plus a manual denylist, used until a real sanctions-screening
/// vendor is integrated.

import type { Address } from "viem";
import type { ComplianceProvider, ScreenResult } from "./screen";

/// Always clears. Real screening (Compliance Engine / Chainalysis / Elliptic / TRM) requires
/// vendor access this deployment doesn't have yet.
export class StubClearProvider implements ComplianceProvider {
  async screenAddress(address: Address): Promise<ScreenResult> {
    return { address, status: "clear", provider: "stub" };
  }
}

/// Flags exactly the addresses an administrator has manually added. Case-insensitive — EIP-55
/// checksum casing must not affect matching. Starts empty by convention — never seed this with
/// an invented "sanctioned" address.
export class ManualDenylistProvider implements ComplianceProvider {
  private readonly denylist: ReadonlySet<string>;
  private readonly reasons: ReadonlyMap<string, string>;

  constructor(entries: Address[] | { address: Address; reason?: string }[]) {
    const normalized = entries.map((e) => (typeof e === "string" ? { address: e } : e));
    this.denylist = new Set(normalized.map((e) => e.address.toLowerCase()));
    this.reasons = new Map(
      normalized.filter((e) => e.reason !== undefined).map((e) => [e.address.toLowerCase(), e.reason!]),
    );
  }

  async screenAddress(address: Address): Promise<ScreenResult> {
    const key = address.toLowerCase();
    if (this.denylist.has(key)) {
      return { address, status: "flagged", reason: this.reasons.get(key) ?? "manually denylisted", provider: "manual-denylist" };
    }
    return { address, status: "clear", provider: "manual-denylist" };
  }
}

/// Composes the denylist and the stub per spec FR-1.3's literal fallback description: denylist
/// hits take priority (a real flag should never be masked by the stub); anything not denylisted
/// falls through to the stub's unconditional "clear".
export function createPhase1ComplianceProvider(
  denylistEntries: Address[] | { address: Address; reason?: string }[],
): ComplianceProvider {
  const denylist = new ManualDenylistProvider(denylistEntries);
  const stub = new StubClearProvider();

  return {
    async screenAddress(address: Address): Promise<ScreenResult> {
      const denylistResult = await denylist.screenAddress(address);
      if (denylistResult.status === "flagged") return denylistResult;
      return stub.screenAddress(address);
    },
  };
}
