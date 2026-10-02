import { afterEach, describe, expect, it, vi } from "vitest";
import { getForwarderStatus } from "../src/kits/browserAdapter";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import {
  clearPendingGatewayMove,
  clearPendingGatewayDeposit,
  gatewayMoveRecoveryFromError,
  readPendingGatewayMove,
  savePendingGatewayMove,
  readPendingGatewayDeposit,
  savePendingGatewayDeposit,
  type KeyValueStorage,
  type PendingGatewayMove,
} from "../src/kits/gatewayRecovery";

function memoryStorage(): KeyValueStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); },
  };
}

const move: PendingGatewayMove = {
  version: 1,
  operationId: "op-1",
  owner: "0x1111111111111111111111111111111111111111",
  sourceChain: "Ethereum_Sepolia",
  arcChainId: 5042002,
  recipient: "0x1111111111111111111111111111111111111111",
  amountUsdc: "0.5",
  state: "submission_unknown",
  createdAt: 100,
};

afterEach(() => vi.unstubAllGlobals());

describe("Gateway recovery records", () => {
  it("survive reload under the wallet-specific key and can be cleared", () => {
    const storage = memoryStorage();
    savePendingGatewayMove(storage, move);
    expect(readPendingGatewayMove(storage, move.owner)).toEqual(move);
    expect(readPendingGatewayMove(storage, "0x2222222222222222222222222222222222222222")).toBeNull();
    clearPendingGatewayMove(storage, move.owner);
    expect(readPendingGatewayMove(storage, move.owner)).toBeNull();
  });

  it("persists an ambiguous deposit baseline and amount for reload-safe balance reconciliation", () => {
    const storage = memoryStorage();
    const deposit = {
      version: 1 as const,
      operationId: "deposit-1",
      owner: move.owner,
      sourceChain: "Ethereum_Sepolia",
      amountUsdc: "1.000001",
      baselineConfirmedUsdc: "7.5",
      state: "submission_unknown" as const,
      createdAt: 100,
    };
    savePendingGatewayDeposit(storage, deposit);
    expect(readPendingGatewayDeposit(storage, move.owner)).toEqual(deposit);
    clearPendingGatewayDeposit(storage, move.owner);
    expect(readPendingGatewayDeposit(storage, move.owner)).toBeNull();
  });

  it("extracts the SDK's original mint retry data and forwarder transfer ID", () => {
    expect(gatewayMoveRecoveryFromError({
      cause: { trace: { attestation: "0x1234", signature: "0xabcd" } },
    })).toEqual({ state: "retry_mint", retryMint: { attestation: "0x1234", signature: "0xabcd" } });
    expect(gatewayMoveRecoveryFromError({ cause: { trace: { transferId: "transfer-123" } } }))
      .toEqual({ state: "forwarder_pending", transferId: "transfer-123" });
    expect(gatewayMoveRecoveryFromError(new Error("network error"))).toEqual({ state: "submission_unknown" });
  });

  it("rejects corrupted or mismatched wallet state on reload", () => {
    const storage = memoryStorage();
    savePendingGatewayMove(storage, move);
    expect(readPendingGatewayMove(storage, "0x2222222222222222222222222222222222222222")).toBeNull();
    storage.setItem("contraflow.gateway.move.v1:0x1111111111111111111111111111111111111111", "{");
    expect(readPendingGatewayMove(storage, move.owner)).toBeNull();
  });

  it("reads the status of the original transfer without submitting a new one", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "finalized", transactionHash: `0x${"a".repeat(64)}` }),
    });
    vi.stubGlobal("fetch", fetch);
    await expect(getForwarderStatus("transfer-id", ARC_TESTNET_CHAIN_ID)).resolves.toEqual({
      status: "finalized",
      transactionHash: `0x${"a".repeat(64)}`,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://gateway-api-testnet.circle.com/v1/transfer/transfer-id",
      { method: "GET", cache: "no-store" },
    );
    await expect(getForwarderStatus("transfer-id", ARC_MAINNET_CHAIN_ID)).rejects.toThrow("only for Arc Testnet");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
