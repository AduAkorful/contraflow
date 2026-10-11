/// viem client factories for Arc. `rpcUrl` is always overridable (not just chain-default) so
/// tests can point at a local anvil
/// instance without touching the real network config.

import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { rpcUrlsFor } from "./rpc";

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
/// An explicit `rpcUrl` (tests, a local anvil) is used as given. On the server the configured
/// endpoint comes first and Arc's documented public endpoints follow, tried in that order when one
/// fails (rate limit, outage); concurrent calls to one endpoint travel as a single JSON-RPC batch.
/// In the browser the chain's own default endpoint is used.
function transportFor(chainId: number, rpcUrl?: string): Transport {
  if (rpcUrl) return http(rpcUrl);
  if (typeof window !== "undefined") return http();
  const urls = rpcUrlsFor(chainId);
  const endpoints = urls.map((url) => http(url, { batch: true, retryCount: 1, timeout: 10_000 }));
  if (endpoints.length === 0) return http();
  return endpoints.length === 1 ? endpoints[0]! : fallback(endpoints, { rank: false, retryCount: 1 });
}

export function createArcPublicClient(chainId: number, rpcUrl?: string): PublicClient {
  return createPublicClient({ chain: chainById(chainId), transport: transportFor(chainId, rpcUrl) });
}

export function createArcWalletClient(chainId: number, privateKey: Hex, rpcUrl?: string): WalletClient {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: chainById(chainId),
    transport: transportFor(chainId, rpcUrl),
  });
}
