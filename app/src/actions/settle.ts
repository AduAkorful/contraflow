/// Business logic behind the Radar + Settle screens (spec §9.1 screens 3-4): read the currently
/// nettable invoices, ask the solver for the best cycle, and submit `settle()`. Split into two
/// functions so Radar can show the proposal before Settle commits to it.

import type { Address, Hex, PublicClient } from "viem";
import { encodeFunctionData } from "viem";
import { proposeSettleCall, type SettleCall } from "@contraflow/solver";
import { contraflowSettlerAbi } from "../contracts/abi/index";
import { fetchNettableInvoiceEdges } from "../chain/readInvoices";
import { submitContractExecutionViaDcw } from "../dcw/contractExecution";
import type { OperatorSigner } from "../operator/signer";

export class NoSettleableCycleError extends Error {
  constructor() {
    super("No cycle among the currently nettable invoices — nothing to settle");
    this.name = "NoSettleableCycleError";
  }
}

/// Radar screen: reads the given invoice ids' current on-chain state and asks the solver for
/// its best proposal, without submitting anything. Returns `null` if no valid cycle exists
/// right now (e.g. not enough nettable invoices, or no closed path among them).
export async function proposeSettlement(params: {
  publicClient: PublicClient;
  registry: Address;
  invoiceIds: readonly Hex[];
}): Promise<SettleCall | null> {
  const edges = await fetchNettableInvoiceEdges(params.publicClient, params.registry, params.invoiceIds);
  return proposeSettleCall(edges);
}

export interface SettleResult {
  invoiceIds: readonly Hex[];
  wNet: bigint;
  txHash: Hex;
  blockNumber: bigint;
  /// Native USDC (18 decimals) actually paid for this tx — feeds the Receipt screen's "gas
  /// paid" tile (spec §9.2). Never conflate with the 6-decimal ERC-20 USDC `wNet` is in.
  gasPaidWei: bigint;
}

/// Settle screen: re-derives the proposal (never trusts a stale one the caller might be holding
/// from an earlier Radar render — on-chain state may have moved) and submits it, regardless of
/// which kind of `OperatorSigner` is given (see `plans/11-orchestration.md`; replaces the
/// two-function shape from `plans/10-dcw-register-settle.md`). `settle()` itself stays
/// permissionless — the signer here is a UI convenience, not an access-control requirement the
/// contract enforces.
export async function settleBestCycle(params: {
  publicClient: PublicClient;
  signer: OperatorSigner;
  registry: Address;
  settler: Address;
  invoiceIds: readonly Hex[];
}): Promise<SettleResult> {
  const { publicClient, signer, registry, settler, invoiceIds } = params;

  const proposal = await proposeSettlement({ publicClient, registry, invoiceIds });
  if (!proposal) throw new NoSettleableCycleError();

  if (signer.kind === "raw-key") {
    const { walletClient } = signer;
    if (!walletClient.account) throw new Error("settleBestCycle: raw-key signer has no account attached");

    const txHash = await walletClient.writeContract({
      address: settler,
      abi: contraflowSettlerAbi,
      functionName: "settle",
      args: [proposal.invoiceIds, proposal.wNet],
      account: walletClient.account,
      chain: walletClient.chain,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`settle() tx ${txHash} reverted (status: ${receipt.status})`);
    }

    return {
      invoiceIds: proposal.invoiceIds,
      wNet: proposal.wNet,
      txHash,
      blockNumber: receipt.blockNumber,
      gasPaidWei: receipt.gasUsed * receipt.effectiveGasPrice,
    };
  }

  const callData = encodeFunctionData({
    abi: contraflowSettlerAbi,
    functionName: "settle",
    args: [proposal.invoiceIds, proposal.wNet],
  });

  const { txHash, blockNumber, gasPaidWei } = await submitContractExecutionViaDcw({
    apiKey: signer.apiKey,
    entitySecret: signer.entitySecret,
    walletId: signer.walletId,
    contractAddress: settler,
    callData,
    feeLevel: signer.feeLevel,
    pollIntervalMs: signer.pollIntervalMs,
    timeoutMs: signer.timeoutMs,
  });

  return {
    invoiceIds: proposal.invoiceIds,
    wNet: proposal.wNet,
    txHash,
    blockNumber,
    gasPaidWei: gasPaidWei ?? 0n,
  };
}
