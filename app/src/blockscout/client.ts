/// Thin client for Blockscout's REST v2 API against `explorer.testnet.arc.io`: it's v2
/// (`/api/v2/...`), not the legacy Etherscan-compatible module, and the legacy module's
/// topic-filtered log search silently returns zero results even for real matches.
/// Reconciliation therefore paginates full decoded contract logs and filters client-side.

import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { blockscoutBaseFor } from "./explorer";

export { blockscoutBaseFor };

const BLOCKSCOUT_BASE = blockscoutBaseFor(ARC_TESTNET_CHAIN_ID);

/// Bounds a single reconciliation call's log-fetch cost — at 50 items/page this is up to 1000
/// decoded logs, comfortably more than this project's actual Registry log volume today. Flagged,
/// not assumed permanent: revisit if the Registry contract sees real sustained traffic.
export const MAX_RECONCILE_PAGES = 20;

export interface DecodedLogParameter {
  name: string;
  type: string;
  value: string | string[];
  indexed?: boolean;
}

export interface DecodedLog {
  /// Contract that emitted this event. Required when event data is used as receipt evidence.
  address?: string;
  transactionHash: string;
  blockNumber: number;
  logIndex?: number;
  methodCall: string | null;
  parameters: DecodedLogParameter[];
}

interface RawLogItem {
  address?: { hash?: string } | string;
  transaction_hash: string;
  block_number: number;
  index: number;
  block_timestamp: string;
  decoded: { method_call: string; parameters: DecodedLogParameter[] } | null;
}

interface RawLogsPage {
  items: RawLogItem[];
  next_page_params: Record<string, string | number> | null;
}

function paramValue(params: DecodedLogParameter[], name: string): string | string[] | undefined {
  return params.find((p) => p.name === name)?.value;
}

export { paramValue };

/// Fetches every decoded log emitted by `contractAddress`, newest-first, up to `MAX_RECONCILE_PAGES`
/// pages. Blockscout's v2 logs endpoint doesn't support server-side filtering by topic value on
/// this deployment (confirmed broken, see module doc comment above), so this returns the full
/// (bounded) page set for the caller to filter.
export interface BoundedContractLogs { logs: DecodedLog[]; truncated: boolean }

export async function fetchContractLogsBounded(contractAddress: string): Promise<BoundedContractLogs> {
  const logs: DecodedLog[] = [];
  let cursor: Record<string, string | number> | null = null;
  let truncated = false;

  for (let page = 0; page < MAX_RECONCILE_PAGES; page++) {
    const url = new URL(`${BLOCKSCOUT_BASE}/api/v2/addresses/${contractAddress}/logs`);
    if (cursor) {
      for (const [key, value] of Object.entries(cursor)) url.searchParams.set(key, String(value));
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Blockscout logs fetch failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as RawLogsPage;

    for (const item of data.items) {
      if (!item.decoded) continue;
      logs.push({
        address: typeof item.address === "string" ? item.address : item.address?.hash ?? "",
        transactionHash: item.transaction_hash,
        blockNumber: item.block_number,
        logIndex: item.index,
        methodCall: item.decoded.method_call,
        parameters: item.decoded.parameters,
      });
    }

    if (!data.next_page_params) break;
    cursor = data.next_page_params;
    if (page === MAX_RECONCILE_PAGES - 1) truncated = true;
  }

  return { logs, truncated };
}

export async function fetchContractLogs(contractAddress: string): Promise<DecodedLog[]> {
  return (await fetchContractLogsBounded(contractAddress)).logs;
}

/// The explorer answered 404: it doesn't know this transaction (never existed, or not indexed yet).
/// Distinct from a failed request so callers can say "not found" instead of erroring.
export class BlockscoutNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockscoutNotFoundError";
  }
}

export interface TransactionFeeInfo {
  blockNumber: number;
  gasPaidWei: string;
}

export async function fetchTransactionFee(txHash: string): Promise<TransactionFeeInfo> {
  const res = await fetch(`${BLOCKSCOUT_BASE}/api/v2/transactions/${txHash}`);
  if (!res.ok) throw new Error(`Blockscout transaction fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { block_number: number; fee: { value: string } };
  return { blockNumber: data.block_number, gasPaidWei: data.fee.value };
}

/// One transaction's own decoded logs — used by the receipt route's on-chain-reconstruction
/// fallback so a single tx hash lookup never needs a full contract log scan.
export async function fetchTransactionLogs(txHash: string): Promise<DecodedLog[]> {
  const res = await fetch(`${BLOCKSCOUT_BASE}/api/v2/transactions/${txHash}/logs`);
  if (res.status === 404) throw new BlockscoutNotFoundError(`Blockscout has no transaction ${txHash}`);
  if (!res.ok) throw new Error(`Blockscout transaction logs fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { items: RawLogItem[] };
  return data.items
    .filter((item) => item.decoded !== null)
    .map((item) => ({
      address: typeof item.address === "string" ? item.address : item.address?.hash ?? "",
      transactionHash: item.transaction_hash,
      blockNumber: item.block_number,
      logIndex: item.index,
      methodCall: item.decoded!.method_call,
      parameters: item.decoded!.parameters,
    }));
}

export async function fetchTransactionTimestamp(txHash: string): Promise<string> {
  const res = await fetch(`${BLOCKSCOUT_BASE}/api/v2/transactions/${txHash}`);
  if (!res.ok) throw new Error(`Blockscout transaction fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { timestamp: string };
  return data.timestamp;
}

/// Per-list bound for an address's activity: 50 items/page, so up to 200 transactions and 200 token
/// transfers per address. When hit, callers get `truncated: true` and must present anything derived
/// from the oldest item as a lower bound, not an exact value.
export const MAX_ACTIVITY_PAGES = 4;

export interface BoundedList<T> {
  items: T[];
  truncated: boolean;
}

async function fetchBoundedPages<Raw, T>(path: string, map: (raw: Raw) => T): Promise<BoundedList<T>> {
  const items: T[] = [];
  let cursor: Record<string, string | number> | null = null;

  for (let page = 0; page < MAX_ACTIVITY_PAGES; page++) {
    const url = new URL(`${BLOCKSCOUT_BASE}${path}`);
    if (cursor) {
      for (const [key, value] of Object.entries(cursor)) url.searchParams.set(key, String(value));
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Blockscout fetch failed for ${path}: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { items: Raw[]; next_page_params: Record<string, string | number> | null };
    items.push(...data.items.map(map));
    if (!data.next_page_params) return { items, truncated: false };
    cursor = data.next_page_params;
  }
  return { items, truncated: true };
}

export interface AddressTransaction {
  hash: string;
  timestamp: string;
  from: string;
  to: string | null;
}

/// Newest-first. Includes incoming transactions, not just ones the address sent.
export function fetchAddressTransactions(address: string): Promise<BoundedList<AddressTransaction>> {
  return fetchBoundedPages<{ hash: string; timestamp: string; from: { hash: string }; to: { hash: string } | null }, AddressTransaction>(
    `/api/v2/addresses/${address}/transactions`,
    (raw) => ({ hash: raw.hash, timestamp: raw.timestamp, from: raw.from.hash, to: raw.to?.hash ?? null }),
  );
}

export interface AddressTokenTransfer {
  transactionHash: string;
  timestamp: string;
  from: string;
  to: string;
  token: string;
}

/// Newest-first. On Arc a plain native-USDC value transfer is also indexed here as a USDC token
/// transfer, and a Circle bridge-in appears as a mint from the zero address — so this list, not
/// the transactions list, is where incoming funding shows up.
export function fetchAddressTokenTransfers(address: string): Promise<BoundedList<AddressTokenTransfer>> {
  return fetchBoundedPages<
    { transaction_hash: string; timestamp: string; from: { hash: string }; to: { hash: string }; token: { address_hash: string } },
    AddressTokenTransfer
  >(`/api/v2/addresses/${address}/token-transfers`, (raw) => ({
    transactionHash: raw.transaction_hash,
    timestamp: raw.timestamp,
    from: raw.from.hash,
    to: raw.to.hash,
    token: raw.token.address_hash,
  }));
}

/// `/api/v2/addresses/{a}` answers 200 even for an address the explorer has never seen, with
/// `is_contract` unset — which correctly reads as "not a contract".
export async function fetchIsContract(address: string): Promise<boolean> {
  const res = await fetch(`${BLOCKSCOUT_BASE}/api/v2/addresses/${address}`);
  if (!res.ok) throw new Error(`Blockscout address fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { is_contract?: boolean | null };
  return data.is_contract === true;
}

/// A log's position in the chain, ordered by block then log index.
export interface LogPosition {
  blockNumber: number;
  logIndex: number;
}

export function isAfter(a: LogPosition, b: LogPosition): boolean {
  return a.blockNumber > b.blockNumber || (a.blockNumber === b.blockNumber && a.logIndex > b.logIndex);
}

export interface PositionedLog extends Omit<DecodedLog, "logIndex">, LogPosition {
  blockTimestamp: string;
}

export interface LogsSince {
  /// Newest-first. Only logs strictly after `since`.
  logs: PositionedLog[];
  /// Undecoded logs after `since`, skipped rather than guessed at.
  undecoded: number;
  /// Position of the newest log after `since`, decoded or not. Null when there's nothing new.
  newest: LogPosition | null;
  /// True when the page cap ran out before reaching `since` (or, with no `since`, before the
  /// contract's first log), so older logs are missing.
  truncated: boolean;
}

/// Every log `contractAddress` emitted after `since` (or all of them when `since` is null), paging
/// newest-first and stopping at the first log at or before `since`.
export async function fetchContractLogsSince(
  chainId: number,
  contractAddress: string,
  since: LogPosition | null,
  maxPages: number,
): Promise<LogsSince> {
  const base = blockscoutBaseFor(chainId);
  const logs: PositionedLog[] = [];
  let undecoded = 0;
  let newest: LogPosition | null = null;
  let cursor: Record<string, string | number> | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${base}/api/v2/addresses/${contractAddress}/logs`);
    if (cursor) {
      for (const [key, value] of Object.entries(cursor)) url.searchParams.set(key, String(value));
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Blockscout logs fetch failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as RawLogsPage;

    for (const item of data.items) {
      const position = { blockNumber: item.block_number, logIndex: item.index };
      if (since && !isAfter(position, since)) return { logs, undecoded, newest, truncated: false };
      newest ??= position;
      if (!item.decoded) {
        undecoded++;
        continue;
      }
      logs.push({
        ...position,
        address: contractAddress,
        transactionHash: item.transaction_hash,
        blockTimestamp: item.block_timestamp,
        methodCall: item.decoded.method_call,
        parameters: item.decoded.parameters,
      });
    }

    if (!data.next_page_params) return { logs, undecoded, newest, truncated: false };
    cursor = data.next_page_params;
  }
  return { logs, undecoded, newest, truncated: true };
}

export interface TransactionSummary {
  from: string;
  feeWei: string;
}

export async function fetchTransactionSummary(chainId: number, txHash: string): Promise<TransactionSummary> {
  const res = await fetch(`${blockscoutBaseFor(chainId)}/api/v2/transactions/${txHash}`);
  if (!res.ok) throw new Error(`Blockscout transaction fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { from: { hash: string }; fee: { value: string } };
  return { from: data.from.hash, feeWei: data.fee.value };
}
