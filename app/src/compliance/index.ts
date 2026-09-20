export type { ComplianceProvider, ComplianceStatus, ScreenResult, FilterFlaggedInvoicesResult } from "./screen";
export { screenAddresses, filterFlaggedInvoices } from "./screen";
export { StubClearProvider, ManualDenylistProvider, createPhase1ComplianceProvider } from "./providers";

import type { Address } from "viem";
import { createPhase1ComplianceProvider } from "./providers";
import type { ComplianceProvider } from "./screen";
import denylistJson from "./denylist.json" with { type: "json" };

/// The provider this app actually uses — denylist entries loaded from the operator-maintained
/// `denylist.json` (empty by default), composed with the stub per spec FR-1.3.
export function defaultComplianceProvider(): ComplianceProvider {
  return createPhase1ComplianceProvider(denylistJson as Address[]);
}
