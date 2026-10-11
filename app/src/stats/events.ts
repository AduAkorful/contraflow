/// Decodes the raw RPC logs protocol stats are counted from. Anything from one of the three
/// contracts that doesn't decode cleanly throws: a silently dropped event would make every total
/// wrong without saying so.

import { decodeEventLog, type Abi, type Hex } from "viem";
import { contraflowNettingLedgerAbi, contraflowRegistryAbi, contraflowSettlerAbi } from "../contracts/abi";

/// `InvoiceStatus.ExtinguishedOnchain` in `IContraflowRegistry.sol`.
const STATUS_FULLY_NETTED = 1;

export type StatsContract = "registry" | "settler" | "ledger";

/// The fields of an `eth_getLogs` entry the stats need, numbers already parsed.
export interface RawLog {
  address: string;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  /// Unix seconds. Arc's RPC includes it on every log.
  blockTimestamp: number;
  removed?: boolean;
}

interface EventBase {
  transactionHash: string;
  blockNumber: bigint;
  logIndex: number;
  blockTimestamp: number;
}

export type StatsEvent = EventBase &
  (
    | { kind: "registered"; debtor: string; creditor: string; amount: bigint }
    | { kind: "netted"; wNet: bigint; fullyNetted: boolean }
    | { kind: "settled" }
    | { kind: "certificateApplied" }
    | { kind: "obligationAdvanced" }
  );

const ABIS: Record<StatsContract, Abi> = {
  registry: contraflowRegistryAbi as Abi,
  settler: contraflowSettlerAbi as Abi,
  ledger: contraflowNettingLedgerAbi as Abi,
};

/// Admin events every proxy emits (deploy, upgrade, EIP-712 domain), which don't count towards anything.
const IGNORED = new Set(["Initialized", "OwnershipTransferred", "Upgraded", "EIP712DomainChanged"]);

export class UnrecognisedStatsEvent extends Error {
  constructor(contract: StatsContract, log: RawLog, detail: string) {
    super(`Unrecognised ${contract} log ${log.transactionHash}#${log.logIndex}: ${detail}`);
    this.name = "UnrecognisedStatsEvent";
  }
}

/// Null for admin events. Throws for anything else it can't read.
export function parseStatsEvent(contract: StatsContract, log: RawLog): StatsEvent | null {
  let decoded: { eventName?: string; args?: unknown };
  try {
    decoded = decodeEventLog({ abi: ABIS[contract], data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
  } catch (error) {
    throw new UnrecognisedStatsEvent(contract, log, error instanceof Error ? error.message.split("\n")[0]! : String(error));
  }
  const name = decoded.eventName ?? "";
  if (IGNORED.has(name)) return null;
  const args = (decoded.args ?? {}) as Record<string, unknown>;
  const base: EventBase = {
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    blockTimestamp: log.blockTimestamp,
  };

  if (contract === "registry" && name === "InvoiceRegistered") {
    return { ...base, kind: "registered", debtor: String(args.debtor), creditor: String(args.creditor), amount: args.amount as bigint };
  }
  if (contract === "registry" && name === "InvoiceNetted") {
    return { ...base, kind: "netted", wNet: args.wNet as bigint, fullyNetted: Number(args.status) === STATUS_FULLY_NETTED };
  }
  if (contract === "settler" && name === "Settled") return { ...base, kind: "settled" };
  if (contract === "ledger" && name === "CertificateApplied") return { ...base, kind: "certificateApplied" };
  if (contract === "ledger" && name === "ObligationAdvanced") return { ...base, kind: "obligationAdvanced" };

  throw new UnrecognisedStatsEvent(contract, log, `event ${name || "(unknown)"} is not counted`);
}
