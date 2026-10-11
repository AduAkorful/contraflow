/// Shared operator-client construction from env vars — factored out so `src/attest/`'s server
/// actions and `/app/demo/actions.ts` share the same construction instead of each inlining it.
/// Server-only: constructs an `OperatorSigner` from `CONTRAFLOW_OPERATOR_PK`, which must never
/// reach client-bundled code.

import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createArcPublicClient, createArcWalletClient } from "./client";
import { APP_CHAIN_ID } from "../contracts/addresses";
import type { OperatorSigner } from "../operator/signer";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} — see app/.env.example`);
  return value;
}

export function operatorSigner(): OperatorSigner {
  const operatorPk = requireEnv("CONTRAFLOW_OPERATOR_PK") as Hex;
  const walletClient = createArcWalletClient(APP_CHAIN_ID, operatorPk);
  return { kind: "raw-key", walletClient };
}

export function arcPublicClient() {
  return createArcPublicClient(APP_CHAIN_ID);
}

/// The operator key's address, or null when the key is unset or malformed. Signing flows report a
/// bad key themselves; read-only callers just need to know whether they can identify it.
export function operatorAddress(): Address | null {
  const pk = process.env.CONTRAFLOW_OPERATOR_PK;
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk as Hex).address;
  } catch {
    return null;
  }
}
