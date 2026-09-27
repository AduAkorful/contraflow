/// Browser-safe: which chains a user can bring USDC to Arc from through Circle Gateway, taken from
/// App Kit's own chain definitions (chain ids, USDC contracts, RPCs), never hand-typed. Imports only
/// App Kit's light `chains` entry, so the wallet provider can use it without loading the kit.

import {
  Arbitrum,
  ArbitrumSepolia,
  Arc,
  ArcTestnet,
  Avalanche,
  AvalancheFuji,
  Base,
  BaseSepolia,
  Ethereum,
  EthereumSepolia,
  HyperEVM,
  HyperEVMTestnet,
  Optimism,
  OptimismSepolia,
  Polygon,
  PolygonAmoy,
  Sei,
  SeiTestnet,
  Sonic,
  SonicTestnet,
  Unichain,
  UnichainSepolia,
  WorldChain,
  WorldChainSepolia,
} from "@circle-fin/app-kit/chains";
import { defineChain, type Chain } from "viem";

import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

export interface GatewayChain {
  /// App Kit's chain name, which is also its `UnifiedBalanceChain` value, e.g. "Ethereum_Sepolia".
  chain: string;
  name: string;
  chainId: number;
  isTestnet: boolean;
  usdcAddress: `0x${string}`;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl: string;
  /// Explorer transaction URL template containing `{hash}`.
  explorerTxUrl: string;
}

type SdkEvmChain = {
  chain: string;
  name: string;
  chainId: number;
  isTestnet: boolean;
  usdcAddress: string | null;
  nativeCurrency: { symbol: string; decimals: number };
  rpcEndpoints: readonly string[];
  explorerUrl: string;
};

function fromSdk(def: SdkEvmChain): GatewayChain {
  if (!def.usdcAddress || !def.rpcEndpoints[0]) throw new Error(`App Kit has no USDC or RPC for ${def.chain}`);
  return {
    chain: def.chain,
    name: def.name,
    chainId: def.chainId,
    isTestnet: def.isTestnet,
    usdcAddress: def.usdcAddress as `0x${string}`,
    nativeSymbol: def.nativeCurrency.symbol,
    nativeDecimals: def.nativeCurrency.decimals,
    rpcUrl: def.rpcEndpoints[0],
    explorerTxUrl: def.explorerUrl,
  };
}

/// Every EVM chain App Kit's Unified Balance kit accepts, apart from Arc itself (the destination).
/// Solana is left out: the browser adapter is EVM-only. A unit test checks each entry against
/// the SDK's `UnifiedBalanceChain` enum.
const SOURCE_CHAINS: readonly GatewayChain[] = [
  Ethereum, Base, Arbitrum, Optimism, Avalanche, Polygon, Unichain, WorldChain, Sonic, Sei, HyperEVM,
  EthereumSepolia, BaseSepolia, ArbitrumSepolia, OptimismSepolia, AvalancheFuji, PolygonAmoy,
  UnichainSepolia, WorldChainSepolia, SonicTestnet, SeiTestnet, HyperEVMTestnet,
].map((def) => fromSdk(def as unknown as SdkEvmChain));

export function networkTypeForChainId(arcChainId: number): "mainnet" | "testnet" {
  return arcChainId === ARC_MAINNET_CHAIN_ID ? "mainnet" : "testnet";
}

/// Source chains on the same network as the app's Arc chain: testnets alongside Arc Testnet,
/// mainnets alongside Arc. Allocations can't mix the two.
export function gatewaySourceChains(arcChainId: number): readonly GatewayChain[] {
  const testnet = networkTypeForChainId(arcChainId) === "testnet";
  return SOURCE_CHAINS.filter((c) => c.isTestnet === testnet);
}

export function gatewayArcChain(arcChainId: number): GatewayChain {
  if (arcChainId === ARC_TESTNET_CHAIN_ID) return fromSdk(ArcTestnet as unknown as SdkEvmChain);
  if (arcChainId === ARC_MAINNET_CHAIN_ID) return fromSdk(Arc as unknown as SdkEvmChain);
  throw new Error(`No Gateway chain for Arc chain id ${arcChainId}`);
}

export function findGatewayChain(arcChainId: number, chain: string): GatewayChain | undefined {
  if (chain === gatewayArcChain(arcChainId).chain) return gatewayArcChain(arcChainId);
  return gatewaySourceChains(arcChainId).find((c) => c.chain === chain);
}

export function explorerTxLink(chain: GatewayChain, txHash: string): string {
  return chain.explorerTxUrl.replace("{hash}", txHash);
}

/// viem chain objects for the wallet provider, so an embedded wallet can switch to a source chain.
export function viemChainFor(chain: GatewayChain): Chain {
  return defineChain({
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: chain.nativeDecimals },
    rpcUrls: { default: { http: [chain.rpcUrl] } },
    blockExplorers: { default: { name: `${chain.name} explorer`, url: new URL(chain.explorerTxUrl.replace("{hash}", "")).origin } },
    testnet: chain.isTestnet,
  });
}

/// `NEXT_PUBLIC_FEATURE_UNIFIED_BALANCE`: `off` hides the page everywhere. On Arc Testnet it's on
/// unless switched off. On Arc mainnet it's off unless set to exactly `mainnet`, which is only done
/// after a live rehearsal with real funds.
export function unifiedBalanceEnabled(
  arcChainId: number,
  flag: string | undefined = process.env.NEXT_PUBLIC_FEATURE_UNIFIED_BALANCE,
): boolean {
  const value = flag?.trim().toLowerCase();
  if (value === "off") return false;
  if (arcChainId === ARC_MAINNET_CHAIN_ID) return value === "mainnet";
  return arcChainId === ARC_TESTNET_CHAIN_ID;
}
