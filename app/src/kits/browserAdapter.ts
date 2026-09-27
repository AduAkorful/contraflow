/// Browser-only: Circle Gateway (Unified Balance) driven by the user's own connected wallet. The
/// wallet signs and pays for everything; nothing here touches a Contraflow key. Must never import
/// `appkit.ts`, which is server-only and holds raw operator keys.

import { AppKitUnifiedBalance } from "@circle-fin/app-kit/unifiedBalance";
import { createAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, getAddress, http, type EIP1193Provider } from "viem";

import { viemChainFor, type GatewayChain } from "./gatewayChains";
import type { FeeLine, GatewayBalancesLike } from "./gatewayBalance";

const TOKEN = "USDC" as const;

/// No telemetry from a user's browser: the SDK otherwise posts transaction hashes and error
/// details to Circle's analytics endpoint.
let kit: AppKitUnifiedBalance | undefined;
function gatewayKit(): AppKitUnifiedBalance {
  kit ??= new AppKitUnifiedBalance({ disableAnalytics: true, disableErrorReporting: true });
  return kit;
}

export type UserAdapter = Awaited<ReturnType<typeof createAdapterFromProvider>>;

export function userAdapter(provider: EIP1193Provider): Promise<UserAdapter> {
  return createAdapterFromProvider({ provider });
}

/// Balances are read by address alone, so they show before (or without) a wallet connection.
export function readGatewayBalances(address: `0x${string}`, networkType: "mainnet" | "testnet"): Promise<GatewayBalancesLike> {
  return gatewayKit().getBalances({
    token: TOKEN,
    sources: { address },
    networkType,
    includePending: true,
  });
}

export async function estimateDeposit(adapter: UserAdapter, source: GatewayChain, amount: string): Promise<FeeLine[]> {
  const result = await gatewayKit().estimateDeposit({
    from: { adapter, chain: source.chain as never },
    amount,
    token: TOKEN,
  });
  return result.fees.map((f) => ({ type: String(f.type), token: String(f.token), amount: String(f.amount) }));
}

export async function deposit(adapter: UserAdapter, source: GatewayChain, amount: string): Promise<{ txHash: string }> {
  const result = await gatewayKit().deposit({
    from: { adapter, chain: source.chain as never },
    amount,
    token: TOKEN,
  });
  return { txHash: result.txHash };
}

/// Arc is reached through Circle's forwarder, so the user needs no Arc gas and never switches to
/// Arc. The recipient is always the depositor's own address: v1 never pays anyone else.
function spendParams(adapter: UserAdapter, source: GatewayChain, arc: GatewayChain, owner: `0x${string}`, amount: string) {
  return {
    from: { adapter, allocations: [{ amount, chain: source.chain as never }] },
    to: { chain: arc.chain as never, recipientAddress: getAddress(owner), useForwarder: true as const },
    token: TOKEN,
    amount,
  };
}

export async function estimateMoveToArc(
  adapter: UserAdapter,
  source: GatewayChain,
  arc: GatewayChain,
  owner: `0x${string}`,
  amount: string,
): Promise<FeeLine[]> {
  const result = await gatewayKit().estimateSpend(spendParams(adapter, source, arc, owner, amount));
  return result.fees.map((f) => ({ type: String(f.type), token: String(f.token), amount: String(f.amount) }));
}

export async function moveToArc(
  adapter: UserAdapter,
  source: GatewayChain,
  arc: GatewayChain,
  owner: `0x${string}`,
  amount: string,
): Promise<{ txHash: string; recipient: string }> {
  const result = await gatewayKit().spend(spendParams(adapter, source, arc, owner, amount));
  return { txHash: result.txHash, recipient: result.recipientAddress };
}

/// ERC-20 USDC held in the wallet itself on `chain`, in base units.
export async function walletUsdc(chain: GatewayChain, owner: `0x${string}`): Promise<bigint> {
  const client = createPublicClient({ chain: viemChainFor(chain), transport: http(chain.rpcUrl) });
  return client.readContract({
    address: chain.usdcAddress,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [owner],
  });
}

/// EIP-7702 delegated accounts keep their own key and sign normally. Any other code at the address
/// means a smart-contract wallet, which can't sign Gateway burn intents without a delegate.
export function isUnsupportedSmartAccount(code: `0x${string}` | undefined): boolean {
  if (!code || code === "0x") return false;
  return !code.toLowerCase().startsWith("0xef0100");
}

export async function walletCode(chain: GatewayChain, owner: `0x${string}`): Promise<`0x${string}` | undefined> {
  const client = createPublicClient({ chain: viemChainFor(chain), transport: http(chain.rpcUrl) });
  return client.getCode({ address: owner });
}
