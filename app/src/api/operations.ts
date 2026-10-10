/// Each API handler's OpenAPI operationId, keyed by the function itself so a minified production
/// bundle (which renames functions) still reports the right operation.

import * as h from "./handlers";
import type { Handler } from "./http";

const OPERATIONS = new Map<unknown, string>([
  [h.getTenant, "getTenant"],
  [h.getUsage, "getUsage"],
  [h.permissionPayload, "getPermissionTypedData"],
  [h.listPermissions, "listPermissions"],
  [h.createPermission, "createPermission"],
  [h.revokePermission, "revokePermission"],
  [h.createObligationProposal, "createObligationProposal"],
  [h.getObligationProposal, "getObligationProposal"],
  [h.withdrawObligationProposal, "withdrawObligationProposal"],
  [h.acceptObligationProposal, "acceptObligationProposal"],
  [h.listPartyObligations, "listPartyObligations"],
  [h.findLoop, "findLoop"],
  [h.getCertificate, "getCertificate"],
  [h.signCertificate, "signCertificate"],
  [h.applyTransaction, "applyTransaction"],
  [h.reportTransaction, "reportTransaction"],
  [h.exportCertificate, "exportCertificate"],
  [h.testWebhook, "testWebhook"],
]);

export function operationOf(handler: Handler): string {
  return OPERATIONS.get(handler) ?? "unknown";
}
