/// The live demo's chain access. The demo always runs on Arc testnet with test funds, whatever
/// chain the deployment serves, so it never shares the operator key or the RPC settings that real
/// activity uses. Server-only: it reads a private key.

import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { APP_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import type { OperatorSigner } from "../operator/signer";
import { createArcPublicClient, createArcWalletClient } from "./client";

export const DEMO_CHAIN_ID = ARC_TESTNET_CHAIN_ID;

/// `DEMO_OPERATOR_PK` is the demo's own testnet key. A deployment that itself serves testnet may
/// keep using `CONTRAFLOW_OPERATOR_PK`; a deployment on any other chain must set the demo key, so
/// the real operator key is never used for demo transactions.
function demoKey(): Hex {
  const own = process.env.DEMO_OPERATOR_PK;
  if (own) return own as Hex;
  const shared = APP_CHAIN_ID === DEMO_CHAIN_ID ? process.env.CONTRAFLOW_OPERATOR_PK : undefined;
  if (shared) return shared as Hex;
  throw new Error("Missing required env var DEMO_OPERATOR_PK — see app/.env.example");
}

export function demoSigner(): OperatorSigner {
  return { kind: "raw-key", walletClient: createArcWalletClient(DEMO_CHAIN_ID, demoKey()) };
}

export function demoPublicClient() {
  return createArcPublicClient(DEMO_CHAIN_ID);
}

/// The demo key's address, or null when it isn't configured.
export function demoOperatorAddress(): Address | null {
  try {
    return privateKeyToAccount(demoKey()).address;
  } catch {
    return null;
  }
}
