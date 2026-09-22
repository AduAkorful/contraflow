/// Shared operator-client construction from env vars — factored out so `src/attest/`'s server
/// actions and `/app/demo/actions.ts` share the same construction instead of each inlining it.
/// Server-only: constructs an `OperatorSigner` from `CONTRAFLOW_OPERATOR_PK`, which must never
/// reach client-bundled code.

import type { Hex } from "viem";
import { createArcPublicClient, createArcWalletClient } from "./client";
import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import type { OperatorSigner } from "../operator/signer";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} — see app/.env.example`);
  return value;
}

export function operatorSigner(): OperatorSigner {
  const operatorPk = requireEnv("CONTRAFLOW_OPERATOR_PK") as Hex;
  const rpcUrl = process.env.ARC_TESTNET_RPC;
  const walletClient = createArcWalletClient(ARC_TESTNET_CHAIN_ID, operatorPk, rpcUrl);
  return { kind: "raw-key", walletClient };
}

export function arcPublicClient() {
  return createArcPublicClient(ARC_TESTNET_CHAIN_ID, process.env.ARC_TESTNET_RPC);
}
