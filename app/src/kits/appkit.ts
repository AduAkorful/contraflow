/// Server-side Circle App Kit construction, mirroring the operator-wallet pattern already used
/// for register()/settle() (`../actions/*.ts`) — no client wallet connection in Phase 1, see
/// `plans/05-app-shell.md`'s design decisions and `plans/06-swap-kit.md`.

import { AppKit, SwapChain } from "@circle-fin/app-kit";
import { createAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createCircleWalletsAdapter, type CircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";

import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

export class UnsupportedSwapChainError extends Error {
  constructor(chainId: number) {
    super(`Swap Kit has no SwapChain enum mapping for chain id ${chainId}`);
    this.name = "UnsupportedSwapChainError";
  }
}

/// Resolves the real `@circle-fin/app-kit` `SwapChain` enum value for a Contraflow chain id.
/// Single source of truth so no call site hand-picks between `SwapChain.Arc`/`Arc_Testnet`.
export function swapChainForChainId(chainId: number): SwapChain {
  if (chainId === ARC_MAINNET_CHAIN_ID) return SwapChain.Arc;
  if (chainId === ARC_TESTNET_CHAIN_ID) return SwapChain.Arc_Testnet;
  throw new UnsupportedSwapChainError(chainId);
}

/// `adapter` is a union, not just the raw-private-key type, so a Circle-custodied signer
/// (`createOperatorAdapterFromCircleWallet` below) is a drop-in alternative wherever a
/// `ContraflowAppKitAdapter` is expected — `swap.ts`/`unifiedBalance.ts` never need to change
/// depending on which one a caller constructs (see `plans/09-dcw-wallet.md`).
///
/// `address` is `undefined` for the raw-private-key path (App Kit's `AddressField` conditional
/// type forbids it there — the adapter resolves its own address) and **required** for the Circle
/// path: confirmed from `AddressField`'s own doc comment — "developer-controlled adapters ...
/// require an explicit address for each operation since they don't have a single connected
/// wallet." Every call site must thread this through only when present, never unconditionally.
export interface ContraflowAppKitAdapter {
  kit: AppKit;
  adapter: ReturnType<typeof createAdapterFromPrivateKey> | CircleWalletsAdapter;
  address?: `0x${string}`;
}

/// Builds an `AppKit` instance plus a server-side signing adapter for the given operator private
/// key. `AppKit` itself takes no required config; the adapter is what carries the signer
/// (matching Contraflow's server-side operator wallet, not a connected browser wallet).
/// Chain-agnostic on purpose — Unified Balance spans a source chain *and* Arc in one flow
/// (`plans/07-unified-balance.md`), so it can't reuse `ContraflowSwapKit`'s single-fixed-chain
/// shape. `createContraflowSwapKit` below builds on this rather than duplicating it.
///
/// `rpcUrl`, when given, is used for both the public and wallet clients the adapter builds per
/// chain — the SDK's own documented mechanism (`getPublicClient`/`getWalletClient` callbacks) for
/// pointing this signer at a specific RPC instead of its default. Added after the raw-key Unified
/// Balance path hit a real transient failure against a free public RPC during the 2026-09-20
/// campaign (`plans/13-orchestration-pipeline.md`) — omitted, behavior is unchanged.
export function createOperatorAdapter(privateKey: Hex, rpcUrl?: string): ContraflowAppKitAdapter {
  if (!rpcUrl) {
    return { kit: new AppKit(), adapter: createAdapterFromPrivateKey({ privateKey }) };
  }
  return {
    kit: new AppKit(),
    adapter: createAdapterFromPrivateKey({
      privateKey,
      getPublicClient: ({ chain }) => createPublicClient({ chain, transport: http(rpcUrl) }),
      getWalletClient: ({ chain, account }) => createWalletClient({ chain, account, transport: http(rpcUrl) }),
    }),
  };
}

/// Same shape as `createOperatorAdapter`, but signed by Circle's Developer-Controlled Wallets
/// instead of a raw private key this repo's code never sees — `apiKey`/`entitySecret` come from
/// `contracts/.env`, see `plans/09-dcw-wallet.md`. `walletAddress` is the specific Circle wallet
/// (under the entity's wallet set) to act as — required, since one entity secret can control many
/// wallets across many chains.
export function createOperatorAdapterFromCircleWallet(
  apiKey: string,
  entitySecret: string,
  walletAddress: `0x${string}`,
): ContraflowAppKitAdapter {
  return { kit: new AppKit(), adapter: createCircleWalletsAdapter({ apiKey, entitySecret }), address: walletAddress };
}

export interface ContraflowSwapKit extends ContraflowAppKitAdapter {
  chain: SwapChain;
}

/// Builds a `ContraflowAppKitAdapter` plus the resolved Swap Kit chain for the given chain id —
/// Swap Kit is same-chain only (spec §3.3: "Phase 1 edges are USDC-only; no FX normalization in
/// the settler"), so one fixed chain per instance is the right shape here.
export function createContraflowSwapKit(privateKey: Hex, chainId: number): ContraflowSwapKit {
  const chain = swapChainForChainId(chainId);
  return { ...createOperatorAdapter(privateKey), chain };
}

/// Same as `createContraflowSwapKit`, signed by a Circle Developer-Controlled Wallet instead of
/// a raw private key.
export function createContraflowSwapKitFromCircleWallet(
  apiKey: string,
  entitySecret: string,
  walletAddress: `0x${string}`,
  chainId: number,
): ContraflowSwapKit {
  const chain = swapChainForChainId(chainId);
  return { ...createOperatorAdapterFromCircleWallet(apiKey, entitySecret, walletAddress), chain };
}
