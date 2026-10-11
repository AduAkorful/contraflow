/// The Registry events the two-party invoice flow reads, in a compact stored form, and decoding of
/// RPC logs into the explorer's `DecodedLog` shape so the existing parsers (`parseRegistered`,
/// `parseNetted`, the receipt checks) work unchanged on chain data.
///
/// Anything from the Registry that doesn't decode cleanly throws: a silently dropped
/// `InvoiceRegistered` would make a nonce wrong without saying so.

import { decodeEventLog, type Abi, type AbiEvent, type Hex } from "viem";
import type { DecodedLog, DecodedLogParameter } from "../blockscout/client";
import { contraflowRegistryAbi, contraflowSettlerAbi } from "../contracts/abi";
import type { RawLog } from "../stats/events";

export interface RegisteredEvent {
  k: "R";
  /// Block number and log index: the event's identity and its order.
  b: number;
  i: number;
  /// Transaction hash.
  t: string;
  id: string;
  /// Debtor and creditor, as decoded (checksummed).
  d: string;
  c: string;
  /// Amount, maturity and nonce as decimal strings.
  a: string;
  m: string;
  e: boolean;
  n: string;
}

export interface NettedEvent {
  k: "N";
  b: number;
  i: number;
  t: string;
  id: string;
  /// wNet and remainingAfter as decimal strings; status as the contract's enum value.
  w: string;
  r: string;
  s: number;
}

export type StoredEvent = RegisteredEvent | NettedEvent;

/// Admin events every proxy emits, which the index doesn't keep.
const IGNORED = new Set(["Initialized", "OwnershipTransferred", "Upgraded", "EIP712DomainChanged"]);

export class UnrecognisedRegistryLog extends Error {
  constructor(log: RawLog, detail: string) {
    super(`Unrecognised Registry log ${log.transactionHash}#${log.logIndex}: ${detail}`);
    this.name = "UnrecognisedRegistryLog";
  }
}

/// Null for admin events. Throws for anything else it can't read.
export function parseRegistryLog(log: RawLog): StoredEvent | null {
  let decoded: { eventName?: string; args?: unknown };
  try {
    decoded = decodeEventLog({
      abi: contraflowRegistryAbi as Abi,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true,
    });
  } catch (error) {
    throw new UnrecognisedRegistryLog(log, error instanceof Error ? error.message.split("\n")[0]! : String(error));
  }
  const name = decoded.eventName ?? "";
  if (IGNORED.has(name)) return null;
  const args = (decoded.args ?? {}) as Record<string, unknown>;
  const position = { b: Number(log.blockNumber), i: log.logIndex, t: log.transactionHash };

  if (name === "InvoiceRegistered") {
    return {
      k: "R",
      ...position,
      id: String(args.id),
      d: String(args.debtor),
      c: String(args.creditor),
      a: (args.amount as bigint).toString(),
      m: (args.maturity as bigint).toString(),
      e: args.earlyNetConsent === true,
      n: (args.nonce as bigint).toString(),
    };
  }
  if (name === "InvoiceNetted") {
    return {
      k: "N",
      ...position,
      id: String(args.id),
      w: (args.wNet as bigint).toString(),
      r: (args.remainingAfter as bigint).toString(),
      s: Number(args.status),
    };
  }
  throw new UnrecognisedRegistryLog(log, `event ${name || "(unknown)"} is not indexed`);
}

/// Sort key: block, then log index, as fixed-width digits so a string sort is a chain sort.
export function eventField(event: { b: number; i: number }): string {
  return `${String(event.b).padStart(12, "0")}:${String(event.i).padStart(6, "0")}`;
}

export function pairKey(debtor: string, creditor: string): string {
  return `${debtor.toLowerCase()}:${creditor.toLowerCase()}`;
}

function param(name: string, type: string, value: string | string[], indexed: boolean): DecodedLogParameter {
  return { name, type, value, indexed };
}

/// The explorer's decoded form of a stored event.
export function toDecodedLog(event: StoredEvent, registry: string): DecodedLog {
  if (event.k === "R") {
    return {
      address: registry,
      transactionHash: event.t,
      blockNumber: event.b,
      logIndex: event.i,
      methodCall:
        "InvoiceRegistered(bytes32 indexed id, address indexed debtor, address indexed creditor, uint256 amount, uint64 maturity, bool earlyNetConsent, uint256 nonce)",
      parameters: [
        param("id", "bytes32", event.id, true),
        param("debtor", "address", event.d, true),
        param("creditor", "address", event.c, true),
        param("amount", "uint256", event.a, false),
        param("maturity", "uint64", event.m, false),
        param("earlyNetConsent", "bool", event.e ? "true" : "false", false),
        param("nonce", "uint256", event.n, false),
      ],
    };
  }
  return {
    address: registry,
    transactionHash: event.t,
    blockNumber: event.b,
    logIndex: event.i,
    methodCall: "InvoiceNetted(bytes32 indexed id, uint256 wNet, uint256 remainingAfter, uint8 status)",
    parameters: [
      param("id", "bytes32", event.id, true),
      param("wNet", "uint256", event.w, false),
      param("remainingAfter", "uint256", event.r, false),
      param("status", "uint8", String(event.s), false),
    ],
  };
}

function stringify(value: unknown): string | string[] {
  if (Array.isArray(value)) return value.map((v) => String(typeof v === "bigint" ? v.toString() : v));
  if (typeof value === "bigint") return value.toString();
  return String(value);
}

export interface ReceiptLog {
  address: string;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number | null;
  transactionHash: string;
}

/// Decodes a transaction's Registry and Settler logs into the explorer's shape. A log from another
/// contract, or one that doesn't decode, is skipped (a receipt lists every log in the transaction).
export function decodeReceiptLogs(logs: readonly ReceiptLog[], contracts: { registry: string; settler: string }): DecodedLog[] {
  const out: DecodedLog[] = [];
  for (const log of logs) {
    const address = log.address.toLowerCase();
    const abi: Abi | null =
      address === contracts.registry.toLowerCase()
        ? (contraflowRegistryAbi as Abi)
        : address === contracts.settler.toLowerCase()
          ? (contraflowSettlerAbi as Abi)
          : null;
    if (!abi || log.topics.length === 0) continue;
    let decoded: { eventName?: string; args?: unknown };
    try {
      decoded = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
    } catch {
      continue;
    }
    const item = abi.find((x): x is AbiEvent => x.type === "event" && x.name === decoded.eventName);
    if (!item) continue;
    const args = (decoded.args ?? {}) as Record<string, unknown>;
    out.push({
      address: log.address,
      transactionHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex ?? 0,
      methodCall: `${item.name}(${item.inputs.map((input) => `${input.type}${"indexed" in input && input.indexed ? " indexed" : ""} ${input.name}`).join(", ")})`,
      parameters: item.inputs.map((input) =>
        param(input.name ?? "", input.type, stringify(args[input.name ?? ""]), "indexed" in input && input.indexed === true),
      ),
    });
  }
  return out;
}
