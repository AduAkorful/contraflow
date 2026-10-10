/// Sending USDC from the signed-in wallet on Arc. Pure helpers: amount and recipient checks, the
/// transfer calldata, the fee reserve, and the pending-send record. Nothing here talks to a server.

import { encodeFunctionData, getAddress, isAddress, isAddressEqual, type Address, type Hex } from "viem";
import { parseUsdcAmount, UsdcAmountError } from "../attest/amount";
import { addressesForChain } from "../contracts/addresses";

const erc20TransferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/// Native USDC (gas) has 18 decimals, the ERC-20 interface 6.
const NATIVE_PER_BASE_UNIT = 10n ** 12n;

/// The fee shown and reserved is the estimate times this, so a small price move can't leave a
/// transfer unable to pay its own gas.
export const FEE_RESERVE_NUMERATOR = 2n;

export function encodeTransfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20TransferAbi, functionName: "transfer", args: [to, amount] });
}

/// Gas used times gas price is in native units (18 decimals). Round up to the 6-decimal unit so the
/// reserve never under-counts.
export function feeInBaseUnits(gasUnits: bigint, gasPriceWei: bigint): bigint {
  const wei = gasUnits * gasPriceWei;
  return (wei + NATIVE_PER_BASE_UNIT - 1n) / NATIVE_PER_BASE_UNIT;
}

export function reservedFee(estimatedFee: bigint): bigint {
  return estimatedFee * FEE_RESERVE_NUMERATOR;
}

/// The most that can be sent while still paying the fee. Zero when the balance can't cover it.
export function maxSendable(balance: bigint, estimatedFee: bigint): bigint {
  const reserve = reservedFee(estimatedFee);
  return balance > reserve ? balance - reserve : 0n;
}

export type AmountCheck = { ok: true; amount: bigint } | { ok: false; error: string };

export function checkSendAmount(input: string, balance: bigint | null, estimatedFee: bigint | null): AmountCheck {
  let amount: bigint;
  try {
    amount = parseUsdcAmount(input);
  } catch (error) {
    return { ok: false, error: error instanceof UsdcAmountError ? error.message : "Enter a valid USDC amount." };
  }
  if (balance === null) return { ok: false, error: "Your balance hasn't loaded yet." };
  if (amount > balance) return { ok: false, error: "That's more than your balance." };
  if (estimatedFee === null) return { ok: false, error: "The network fee couldn't be checked yet." };
  if (amount + reservedFee(estimatedFee) > balance) {
    return { ok: false, error: "Leave enough USDC to pay the network fee. Use Max to send the most you can." };
  }
  return { ok: true, amount };
}

export type RecipientCheck =
  | { ok: true; address: Address }
  | { ok: false; error: string };

/// Addresses nothing should ever be sent to from here: funds sent to Contraflow's own contracts or
/// the USDC contract itself can't be recovered by anyone.
export function protocolAddresses(chainId: number): Address[] {
  const a = addressesForChain(chainId);
  return [a.usdc, a.registry, a.settler, a.nettingLedger].map((address) => getAddress(address));
}

export function checkRecipient(input: string, sender: string, chainId: number): RecipientCheck {
  const value = input.trim();
  if (value === "") return { ok: false, error: "Enter a recipient address." };
  if (!isAddress(value, { strict: false })) return { ok: false, error: "That isn't a valid address." };
  const address = getAddress(value.toLowerCase());
  if (/^0x0{40}$/i.test(address)) return { ok: false, error: "That's the zero address. Funds sent there are lost." };
  if (isAddressEqual(address, getAddress(sender))) return { ok: false, error: "That's your own address." };
  if (protocolAddresses(chainId).some((p) => isAddressEqual(p, address))) {
    return { ok: false, error: "That's a Contraflow or USDC contract address. Funds sent there can't be recovered." };
  }
  return { ok: true, address };
}

/// A plain-language reason for a failed transfer, from the revert text the USDC contract returns.
export function transferFailureMessage(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const lower = text.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("rejected the request") || lower.includes("denied")) {
    return "Cancelled. Nothing was sent.";
  }
  if (lower.includes("blocked address")) return "USDC can't be sent to that address. Nothing was sent.";
  if (lower.includes("zero address")) return "That's the zero address. Nothing was sent.";
  if (lower.includes("insufficient funds") || lower.includes("exceeds balance")) {
    return "Your balance can't cover that amount and the network fee.";
  }
  return "The transfer didn't go through. Check your balance and try again.";
}

// Pending record ---------------------------------------------------------------------------------

export interface PendingSend {
  version: 1;
  owner: string;
  chainId: number;
  to: Address;
  amount: string; // base units, decimal
  createdAt: number;
  txHash?: Hex;
}

const KEY_PREFIX = "contraflow:pending-send:";
export const SEND_RECOVERY_EVENT = "contraflow:send-recovery";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const keyFor = (owner: string) => `${KEY_PREFIX}${owner.toLowerCase()}`;

export function readPendingSend(storage: StorageLike, owner: string): PendingSend | null {
  const raw = storage.getItem(keyFor(owner));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingSend;
    if (parsed.version !== 1 || parsed.owner !== owner.toLowerCase() || !isAddress(parsed.to)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingSend(storage: StorageLike, record: PendingSend): void {
  storage.setItem(keyFor(record.owner), JSON.stringify({ ...record, owner: record.owner.toLowerCase() }));
}

export function clearPendingSend(storage: StorageLike, owner: string): void {
  storage.removeItem(keyFor(owner));
}
