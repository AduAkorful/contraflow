/// viem client factories for Arc. `rpcUrl` is always overridable (not just chain-default) so
/// tests can point at a local anvil
/// instance without touching the real network config.

import { createPublicClient, createWalletClient, http, type Chain, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

export const arcTestnet: Chain = {
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "Native USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
};

export const arcMainnet: Chain = {
  id: ARC_MAINNET_CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "Native USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
};

const CHAINS_BY_ID: Record<number, Chain> = {
  [arcTestnet.id]: arcTestnet,
  [arcMainnet.id]: arcMainnet,
};

export class UnknownArcChainError extends Error {
  constructor(chainId: number) {
    super(`No Arc chain definition for chain id ${chainId}`);
    this.name = "UnknownArcChainError";
  }
}

export function chainById(chainId: number): Chain {
  const chain = CHAINS_BY_ID[chainId];
  if (!chain) throw new UnknownArcChainError(chainId);
  return chain;
}

// Explicit `PublicClient`/`WalletClient` return-type annotations below aren't decorative —
// without them, `tsconfig.json`'s `declaration: true` fails to build a `.d.ts` for these
// functions at all (TS2742: the inferred type reaches into viem's internal per-action type
// files, which isn't a "portable" type it can re-emit).
export function createArcPublicClient(chainId: number, rpcUrl?: string): PublicClient {
  return createPublicClient({ chain: chainById(chainId), transport: http(rpcUrl) });
}

export function createArcWalletClient(chainId: number, privateKey: Hex, rpcUrl?: string): WalletClient {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: chainById(chainId),
    transport: http(rpcUrl),
  });
}
