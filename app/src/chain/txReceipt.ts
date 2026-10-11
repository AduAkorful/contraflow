/// One transaction's receipt read straight from the chain: the Registry and Settler logs in the
/// explorer's decoded shape, the block, and the gas paid. Replaces the explorer's transaction
/// endpoints for receipts and settlement reconciliation. Server-only.

import { TransactionReceiptNotFoundError, type PublicClient } from "viem";
import type { DecodedLog } from "../blockscout/client";
import { decodeReceiptLogs } from "../chainindex/events";
import { addressesForChain } from "../contracts/addresses";
import { createArcPublicClient } from "./client";

export interface ChainTransaction {
  blockNumber: number;
  /// Native USDC wei (18 decimals): `gasUsed × effectiveGasPrice`.
  gasPaidWei: string;
  status: "success" | "reverted";
  logs: DecodedLog[];
}

/// Null when the chain has no receipt for the hash (never existed, or not mined yet).
export async function fetchTransactionFromChain(
  chainId: number,
  txHash: string,
  client: PublicClient = createArcPublicClient(chainId),
): Promise<ChainTransaction | null> {
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return null;
    throw error;
  }
  const { registry, settler } = addressesForChain(chainId);
  return {
    blockNumber: Number(receipt.blockNumber),
    gasPaidWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    status: receipt.status,
    logs: decodeReceiptLogs(receipt.logs, { registry, settler }),
  };
}
