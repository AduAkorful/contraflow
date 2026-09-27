/// Decodes the contract events protocol stats are counted from. Anything that doesn't parse cleanly
/// throws: a silently dropped event would make every total wrong without saying so.

import { paramValue, type PositionedLog } from "../blockscout/client";
import { parseNetted, parseRegistered } from "../blockscout/reconcile";

/// `InvoiceStatus.ExtinguishedOnchain` in `IContraflowRegistry.sol`.
const STATUS_FULLY_NETTED = "1";

interface EventBase {
  transactionHash: string;
  blockTimestamp: string;
}

export type StatsEvent = EventBase &
  (
    | { kind: "registered"; debtor: string; creditor: string; amount: bigint }
    | { kind: "netted"; wNet: bigint; fullyNetted: boolean }
    | { kind: "settled" }
    | { kind: "certificateApplied" }
    | { kind: "obligationAdvanced" }
  );

export type StatsContract = "registry" | "settler" | "ledger";

/// Admin events every proxy emits (deploy, upgrade), which don't count towards anything.
const IGNORED = ["Initialized(", "OwnershipTransferred(", "Upgraded("];

export class UnrecognisedStatsEvent extends Error {
  constructor(contract: StatsContract, log: PositionedLog) {
    super(`Unrecognised ${contract} event ${log.methodCall ?? "(undecoded)"} in ${log.transactionHash}`);
  }
}

function base(log: PositionedLog): EventBase {
  return { transactionHash: log.transactionHash, blockTimestamp: log.blockTimestamp };
}

/// Null for admin events. Throws for anything else it can't read.
export function parseStatsEvent(contract: StatsContract, log: PositionedLog): StatsEvent | null {
  const method = log.methodCall ?? "";
  if (IGNORED.some((prefix) => method.startsWith(prefix))) return null;

  if (contract === "registry") {
    const registered = parseRegistered(log);
    if (registered) {
      return {
        ...base(log),
        kind: "registered",
        debtor: registered.debtor,
        creditor: registered.creditor,
        amount: registered.amountBaseUnits,
      };
    }
    const netted = parseNetted(log);
    const status = paramValue(log.parameters, "status");
    if (netted && typeof status === "string") {
      return { ...base(log), kind: "netted", wNet: netted.wNetBaseUnits, fullyNetted: status === STATUS_FULLY_NETTED };
    }
  }

  if (contract === "settler" && method.startsWith("Settled(")) return { ...base(log), kind: "settled" };

  if (contract === "ledger") {
    if (method.startsWith("CertificateApplied(")) return { ...base(log), kind: "certificateApplied" };
    if (method.startsWith("ObligationAdvanced(")) return { ...base(log), kind: "obligationAdvanced" };
  }

  throw new UnrecognisedStatsEvent(contract, log);
}
