/// Server-side Circle App Kit construction, mirroring the operator-wallet pattern already used
/// for register()/settle() (`../actions/*.ts`) — no client wallet connection here.

import { AppKit, SwapChain } from "@circle-fin/app-kit";
import { createAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createCircleWalletsAdapter, type CircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem";

import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

export class UnsupportedSwapChainError extends Error {
  constructor(chainId: number) {
    super(`Swap Kit has no SwapChain enum mapping for chain id ${chainId}`);
    this.name = "UnsupportedSwapChainError";
  }
}

export class RpcChainMismatchError extends Error {
  constructor(expectedChainId: number, actualChainId: bigint) {
    super(`Configured RPC for chain ${expectedChainId} reports chain ${actualChainId}`);
    this.name = "RpcChainMismatchError";
  }
}

function chainValidatedFetch(url: string, expectedChainId: number): typeof fetch {
  let validation: Promise<void> | undefined;
  return async (_input, init) => {
    validation ??= (async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        signal: init?.signal,
      });
      if (!response.ok) throw new Error(`RPC chain check failed with HTTP ${response.status}`);
      const body: unknown = await response.json();
      const result = body && typeof body === "object" ? (body as { result?: unknown }).result : undefined;
      if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
        throw new Error("RPC chain check returned an invalid eth_chainId result");
      }
      const actualChainId = BigInt(result);
      if (actualChainId !== BigInt(expectedChainId)) {
        throw new RpcChainMismatchError(expectedChainId, actualChainId);
      }
    })();
    try {
      await validation;
    } catch (error) {
      // A transient HTTP/parse failure is retryable; a deterministic wrong chain will fail closed
      // again on the next attempt without ever forwarding that operation.
      validation = undefined;
      throw error;
    }
    return fetch(url, init);
  };
}

export function chainCheckedHttpTransport(url: string, expectedChainId: number): ReturnType<typeof http> {
  return http(url, { fetchFn: chainValidatedFetch(url, expectedChainId) });
}

function rpcForChain(chain: Chain, overrides: Readonly<Record<number, string>>) {
  const url = overrides[chain.id];
  return url ? chainCheckedHttpTransport(url, chain.id) : http();
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
/// depending on which one a caller constructs.
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
/// Chain-agnostic on purpose — Unified Balance spans a source chain *and* Arc in one flow, so it
/// can't reuse `ContraflowSwapKit`'s single-fixed-chain shape. `createContraflowSwapKit` below
/// builds on this rather than duplicating it.
///
/// RPC overrides are keyed by EIP-155 chain ID because Unified Balance can create clients for
/// both a source chain and Arc in one operation. An override is checked with `eth_chainId` before
/// its first application request; chains without an override keep the SDK/chain default RPC.
export function createOperatorAdapter(
  privateKey: Hex,
  options?: { rpcUrlsByChainId?: Readonly<Record<number, string>> },
): ContraflowAppKitAdapter {
  const rpcUrlsByChainId = options?.rpcUrlsByChainId;
  if (!rpcUrlsByChainId || Object.keys(rpcUrlsByChainId).length === 0) {
    return { kit: new AppKit(), adapter: createAdapterFromPrivateKey({ privateKey }) };
  }
  return {
    kit: new AppKit(),
    adapter: createAdapterFromPrivateKey({
      privateKey,
      getPublicClient: ({ chain }) => createPublicClient({ chain, transport: rpcForChain(chain, rpcUrlsByChainId) }),
      getWalletClient: ({ chain, account }) => createWalletClient({ chain, account, transport: rpcForChain(chain, rpcUrlsByChainId) }),
    }),
  };
}

/// Same shape as `createOperatorAdapter`, but signed by Circle's Developer-Controlled Wallets
/// instead of a raw private key this repo's code never sees — `apiKey`/`entitySecret` come from
/// environment config. `walletAddress` is the specific Circle wallet (under the entity's wallet
/// set) to act as — required, since one entity secret can control many wallets across many
/// chains.
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
/// Swap Kit is same-chain only (invoice edges are USDC-only; no FX normalization happens in the
/// settler), so one fixed chain per instance is the right shape here.
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
