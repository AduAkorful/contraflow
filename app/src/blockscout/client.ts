/// Thin client for Blockscout's REST v2 API against `explorer.testnet.arc.io` — confirmed live
/// (not assumed) this session: it's v2 (`/api/v2/...`), not the legacy Etherscan-compatible
/// module, and the legacy module's topic-filtered log search silently returns zero results even
/// for real matches — see plans/19-database-blockscout-reconciliation.md's "Live discovery"
/// section. Reconciliation therefore paginates full decoded contract logs and filters client-side.

const BLOCKSCOUT_BASE = "https://explorer.testnet.arc.io";

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
  transactionHash: string;
  blockNumber: number;
  methodCall: string | null;
  parameters: DecodedLogParameter[];
}

interface RawLogItem {
  transaction_hash: string;
  block_number: number;
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
export async function fetchContractLogs(contractAddress: string): Promise<DecodedLog[]> {
  const logs: DecodedLog[] = [];
  let cursor: Record<string, string | number> | null = null;

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
        transactionHash: item.transaction_hash,
        blockNumber: item.block_number,
        methodCall: item.decoded.method_call,
        parameters: item.decoded.parameters,
      });
    }

    if (!data.next_page_params) break;
    cursor = data.next_page_params;
  }

  return logs;
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
  if (!res.ok) throw new Error(`Blockscout transaction logs fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { items: RawLogItem[] };
  return data.items
    .filter((item) => item.decoded !== null)
    .map((item) => ({
      transactionHash: item.transaction_hash,
      blockNumber: item.block_number,
      methodCall: item.decoded!.method_call,
      parameters: item.decoded!.parameters,
    }));
}
