/// Submits arbitrary contract calldata through a Circle Developer-Controlled Wallet and waits
/// for it to reach a terminal state. Separate from `app/src/kits/appkit.ts`'s adapters —
/// `register()`/`settle()` are raw `writeContract` calls, not an App Kit adapter operation, so
/// they need Circle's contract-execution transaction API instead of a Swap-Kit-style adapter.

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { parseEther, type Address, type Hex } from "viem";

export class DcwTransactionFailedError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly state: string,
    public readonly errorReason?: string,
  ) {
    super(`DCW transaction ${transactionId} ended in state ${state}${errorReason ? `: ${errorReason}` : ""}`);
    this.name = "DcwTransactionFailedError";
  }
}

export class DcwTransactionTimeoutError extends Error {
  constructor(public readonly transactionId: string, public readonly lastState: string) {
    super(`DCW transaction ${transactionId} did not reach a terminal state (last: ${lastState})`);
    this.name = "DcwTransactionTimeoutError";
  }
}

const TERMINAL_SUCCESS_STATES = new Set(["CONFIRMED", "COMPLETE"]);
const TERMINAL_FAILURE_STATES = new Set(["FAILED", "DENIED", "CANCELLED"]);

export interface SubmitContractExecutionViaDcwParams {
  apiKey: string;
  entitySecret: string;
  walletId: string;
  contractAddress: Address;
  /// Pre-encoded via viem's `encodeFunctionData` — never Circle's own
  /// `abiFunctionSignature`/`abiParameters` string encoding, so there is exactly one ABI-encoding
  /// path for these calls, shared with the raw-`WalletClient` submission path.
  callData: Hex;
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface DcwContractExecutionResult {
  txHash: Hex;
  blockNumber: bigint;
  /// Native USDC (18 decimals), parsed from Circle's decimal-string `networkFee` — mirrors
  /// `SettleResult.gasPaidWei`'s convention. `undefined` when Circle didn't report one.
  gasPaidWei?: bigint;
}

/// Submits `callData` to `contractAddress` from `walletId`, then polls until Circle reports a
/// terminal state — submission itself only returns `{ id, state }`, not yet an on-chain result
/// (`TransactionState` starts `INITIATED`/`QUEUED`; a real `txHash`/`blockHeight` only exist once
/// the state reaches `CONFIRMED`/`COMPLETE`). Throws `DcwTransactionFailedError` on
/// `FAILED`/`DENIED`/`CANCELLED`, mirroring `registerInvoice`'s/`settleBestCycle`'s existing
/// "throw on non-success" convention for the raw-`WalletClient` path.
export async function submitContractExecutionViaDcw(
  params: SubmitContractExecutionViaDcwParams,
): Promise<DcwContractExecutionResult> {
  const {
    apiKey,
    entitySecret,
    walletId,
    contractAddress,
    callData,
    feeLevel = "MEDIUM",
    pollIntervalMs = 2_000,
    timeoutMs = 120_000,
  } = params;

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  const submitted = await client.createContractExecutionTransaction({
    walletId,
    contractAddress,
    callData,
    fee: { type: "level", config: { feeLevel } },
  });
  const transactionId = submitted.data!.id;

  const deadline = Date.now() + timeoutMs;
  let lastState = submitted.data!.state;
  while (Date.now() < deadline) {
    const polled = await client.getTransaction({ id: transactionId });
    const tx = polled.data?.transaction;
    if (!tx) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }
    lastState = tx.state;

    if (TERMINAL_FAILURE_STATES.has(tx.state)) {
      throw new DcwTransactionFailedError(transactionId, tx.state, tx.errorReason);
    }
    if (TERMINAL_SUCCESS_STATES.has(tx.state)) {
      if (!tx.txHash || tx.blockHeight === undefined) {
        throw new Error(`DCW transaction ${transactionId} reached ${tx.state} without txHash/blockHeight`);
      }
      return {
        txHash: tx.txHash as Hex,
        blockNumber: BigInt(tx.blockHeight),
        gasPaidWei: tx.networkFee ? parseEther(tx.networkFee) : undefined,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new DcwTransactionTimeoutError(transactionId, lastState);
}
