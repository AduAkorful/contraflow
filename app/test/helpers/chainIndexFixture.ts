/// Builds real, ABI-encoded Registry logs and a fake RPC over them, so chain-index tests exercise
/// the decoding the production code does.

import { encodeAbiParameters, encodeEventTopics, type Abi, type Hex } from "viem";
import { contraflowRegistryAbi } from "../../src/contracts/abi";
import type { RawLog } from "../../src/stats/events";
import type { StatsRpc } from "../../src/stats/indexer";

export const REGISTRY = "0x304450Dc27f644AcA55773895409ff500AFb2Bf7";
const abi = contraflowRegistryAbi as Abi;

export interface Position {
  block: number;
  index: number;
  tx?: string;
}

function base(position: Position, topics: Hex[], data: Hex): RawLog {
  return {
    address: REGISTRY,
    topics,
    data,
    blockNumber: BigInt(position.block),
    logIndex: position.index,
    transactionHash: position.tx ?? `0x${position.block.toString(16).padStart(64, "0")}`,
    blockTimestamp: 1_800_000_000 + position.block,
  };
}

export function registeredLog(
  position: Position,
  args: { id: Hex; debtor: Hex; creditor: Hex; amount?: bigint; maturity?: bigint; earlyNetConsent?: boolean; nonce: bigint },
): RawLog {
  const topics = encodeEventTopics({ abi, eventName: "InvoiceRegistered", args: { id: args.id, debtor: args.debtor, creditor: args.creditor } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint64" }, { type: "bool" }, { type: "uint256" }],
    [args.amount ?? 1_000_000n, args.maturity ?? 1_900_000_000n, args.earlyNetConsent ?? false, args.nonce],
  );
  return base(position, topics as Hex[], data);
}

export function nettedLog(position: Position, args: { id: Hex; wNet: bigint; remainingAfter: bigint; status?: number }): RawLog {
  const topics = encodeEventTopics({ abi, eventName: "InvoiceNetted", args: { id: args.id } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint8" }],
    [args.wNet, args.remainingAfter, args.status ?? 0],
  );
  return base(position, topics as Hex[], data);
}

/// A chain whose Registry emitted `logs`, with `head` as the newest block.
export function fakeIndexRpc(logs: RawLog[], head: bigint): StatsRpc & { calls: { getLogs: [bigint, bigint][]; blockNumber: number }; head: bigint } {
  const state = { head, calls: { getLogs: [] as [bigint, bigint][], blockNumber: 0 } };
  return {
    get head() {
      return state.head;
    },
    set head(value: bigint) {
      state.head = value;
    },
    calls: state.calls,
    blockNumber: async () => {
      state.calls.blockNumber++;
      return state.head;
    },
    getLogs: async (_addresses, from, to) => {
      state.calls.getLogs.push([from, to]);
      if (to - from + 1n > 9_999n) throw new Error("range too large");
      return logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
    },
  } as StatsRpc & { calls: { getLogs: [bigint, bigint][]; blockNumber: number }; head: bigint };
}

export const A = "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C" as const;
export const B = "0xD98CC80747e67B357EA914614C213209c877Be04" as const;
export const C = "0x0000000000000000000000000000000000dead00" as const;
export const id = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
