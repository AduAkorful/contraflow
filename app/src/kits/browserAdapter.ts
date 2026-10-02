/// Browser-only: Circle Gateway (Unified Balance) driven by the user's own connected wallet. The
/// wallet signs and pays for everything; nothing here touches a Contraflow key. Must never import
/// `appkit.ts`, which is server-only and holds raw operator keys.

import { AppKitUnifiedBalance } from "@circle-fin/app-kit/unifiedBalance";
import { createAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, getAddress, http, type EIP1193Provider } from "viem";

import { viemChainFor, type GatewayChain } from "./gatewayChains";
import type { FeeLine, GatewayBalancesLike } from "./gatewayBalance";
import type { GatewayMintRetry } from "./unifiedBalance";
import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

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
): Promise<{ txHash: string; recipient: string; transferId?: string; expirationBlock?: string }> {
  const result = await gatewayKit().spend(spendParams(adapter, source, arc, owner, amount));
  return {
    txHash: result.txHash,
    recipient: result.recipientAddress,
    transferId: result.transferId,
    expirationBlock: result.expirationBlock,
  };
}

export async function retryMoveMint(
  adapter: UserAdapter,
  arc: GatewayChain,
  owner: `0x${string}`,
  amount: string,
  retry: GatewayMintRetry,
): Promise<{ txHash: string; recipient: string }> {
  const result = await gatewayKit().spend({
    to: { adapter, chain: arc.chain as never },
    token: TOKEN,
    amount,
    config: { retry },
  });
  return { txHash: result.txHash, recipient: result.recipientAddress };
}

export type GatewayForwarderStatus = "pending" | "confirmed" | "finalized" | "failed" | "expired";

/// Reads only the original transfer's forwarding state. A status check never creates a new transfer.
export async function getForwarderStatus(transferId: string, arcChainId: number): Promise<{
  status: GatewayForwarderStatus;
  transactionHash?: string;
  failureReason?: string;
  expirationBlock?: string;
}> {
  if (arcChainId !== ARC_TESTNET_CHAIN_ID) throw new Error("Gateway recovery status is currently enabled only for Arc Testnet.");
  if (!transferId || transferId.length > 256) throw new Error("Gateway transfer identifier is invalid.");
  const response = await fetch(`https://gateway-api-testnet.circle.com/v1/transfer/${encodeURIComponent(transferId)}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Circle could not read the original transfer status (${response.status}).`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("Circle returned an invalid transfer status.");
  const record = body as Record<string, unknown>;
  const statuses: GatewayForwarderStatus[] = ["pending", "confirmed", "finalized", "failed", "expired"];
  if (typeof record.status !== "string" || !statuses.includes(record.status as GatewayForwarderStatus)) {
    throw new Error("Circle returned an unrecognized transfer status.");
  }
  const forwarding = record.forwardingDetails && typeof record.forwardingDetails === "object"
    ? record.forwardingDetails as Record<string, unknown>
    : undefined;
  const attestation = record.attestation && typeof record.attestation === "object"
    ? record.attestation as Record<string, unknown>
    : undefined;
  if (record.transactionHash !== undefined && (typeof record.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(record.transactionHash))) {
    throw new Error("Circle returned an invalid destination transaction hash.");
  }
  if (attestation?.expirationBlock !== undefined && (typeof attestation.expirationBlock !== "string" || !/^\d+$/.test(attestation.expirationBlock))) {
    throw new Error("Circle returned an invalid attestation expiry block.");
  }
  return {
    status: record.status as GatewayForwarderStatus,
    ...(typeof record.transactionHash === "string" ? { transactionHash: record.transactionHash } : {}),
    ...(typeof forwarding?.failureReason === "string" ? { failureReason: forwarding.failureReason } : {}),
    ...(typeof attestation?.expirationBlock === "string" ? { expirationBlock: attestation.expirationBlock } : {}),
  };
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
