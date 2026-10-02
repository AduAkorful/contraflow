/// Server-only: fetches explorer activity and turns it into inspector signals, with a short-lived
/// Upstash cache in front. Signals change slowly and a cycle view fans out to several explorer
/// requests per party, so repeat views are served from cache rather than re-hitting Blockscout,
/// which has rate-limited this project before.

import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import {
  fetchAddressTokenTransfers,
  fetchAddressTransactions,
  fetchContractLogsBounded,
  fetchIsContract,
  fetchTransactionLogs,
  fetchTransactionTimestamp,
  type DecodedLog,
} from "../blockscout/client";
import { parseNetted, parseRegistered, type RegisteredEvent } from "../blockscout/reconcile";
import { redis } from "../upstash/client";
import { operatorAddress } from "../chain/operatorEnv";
import { addressSignals, cycleSignals, type AddressSignals, type CycleSignals, type KnownAddresses } from "./signals";

const CACHE_TTL_SECONDS = 600;
/// Bump whenever the cached signal shape changes, so an old entry is never rendered by new code.
const CACHE_VERSION = "v2";

function knownAddresses(): KnownAddresses {
  const { registry, settler, usdc } = addressesForChain(ARC_TESTNET_CHAIN_ID);
  return { registry, settler, usdc, operator: operatorAddress() };
}

function cacheKey(kind: "address" | "cycle", id: string): string {
  return `inspector:${CACHE_VERSION}:${ARC_TESTNET_CHAIN_ID}:${kind}:${id.toLowerCase()}`;
}

/// Cache failures never fail the lookup — an unreachable cache just means a direct fetch.
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis().get<T>(key);
    if (hit) return hit;
  } catch {
    return load();
  }
  const value = await load();
  if (value === null) return value;
  try {
    await redis().set(key, value, { ex: CACHE_TTL_SECONDS });
  } catch {
    // Serving the fresh value matters more than caching it.
  }
  return value;
}

interface RegisteredWithBlock extends RegisteredEvent {
  blockNumber: number;
}

function registeredEvents(logs: DecodedLog[]): RegisteredWithBlock[] {
  const events: RegisteredWithBlock[] = [];
  for (const log of logs) {
    const event = parseRegistered(log);
    if (event) events.push({ ...event, blockNumber: log.blockNumber });
  }
  return events;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/// Timestamp of the earliest registered invoice naming `address`, for parties with no activity of
/// their own. Registry logs are fetched lazily, and at most once per request.
interface RegistryLogScan { events: RegisteredWithBlock[]; truncated: boolean }

async function firstInvoiceAt(address: string, registryLogs: () => Promise<RegistryLogScan>): Promise<{ at: string | null; lowerBound: boolean }> {
  const scan = await registryLogs();
  const mine = scan.events.filter((e) => sameAddress(e.debtor, address) || sameAddress(e.creditor, address));
  if (mine.length === 0) return { at: null, lowerBound: scan.truncated };
  const earliest = mine.reduce((min, e) => (e.blockNumber < min.blockNumber ? e : min));
  return { at: await fetchTransactionTimestamp(earliest.registerTxHash), lowerBound: scan.truncated };
}

async function loadAddressSignals(
  address: string,
  known: KnownAddresses,
  registryLogs: () => Promise<RegistryLogScan>,
): Promise<AddressSignals> {
  return cached(cacheKey("address", address), async () => {
    const [isContract, transactions, transfers] = await Promise.all([
      fetchIsContract(address),
      fetchAddressTransactions(address),
      fetchAddressTokenTransfers(address),
    ]);
    const hasOwnActivity = transactions.items.length > 0 || transfers.items.length > 0;
    const invoiceFirstSeen = hasOwnActivity ? null : await firstInvoiceAt(address, registryLogs);
    return addressSignals(
      {
        address,
        isContract,
        transactions,
        transfers,
        firstInvoiceAt: invoiceFirstSeen?.at ?? null,
        firstInvoiceLowerBound: invoiceFirstSeen?.lowerBound ?? false,
      },
      known,
    );
  });
}

function memoizedRegistryLogs(registry: string): () => Promise<RegistryLogScan> {
  let pending: Promise<RegistryLogScan> | null = null;
  return () => (pending ??= fetchContractLogsBounded(registry).then((scan) => ({ events: registeredEvents(scan.logs), truncated: scan.truncated })));
}

export async function getAddressSignals(address: string): Promise<AddressSignals> {
  const known = knownAddresses();
  return loadAddressSignals(address, known, memoizedRegistryLogs(known.registry));
}

/// Null when `settleTxHash` isn't a settle() transaction on this deployment.
export async function getCycleSignals(settleTxHash: string): Promise<CycleSignals | null> {
  return cached(cacheKey("cycle", settleTxHash), async () => {
    const known = knownAddresses();
    const nettedIds = (await fetchTransactionLogs(settleTxHash))
      .map(parseNetted)
      .filter((n) => n !== null)
      .map((n) => n.invoiceRef);
    if (nettedIds.length === 0) return null;

    const registryLogs = memoizedRegistryLogs(known.registry);
    const registryScan = await registryLogs();
    const registered = registryScan.events;
    const cycleInvoices = nettedIds
      .map((id) => registered.find((e) => e.invoiceRef === id))
      .filter((e) => e !== undefined);

    // Each party is the debtor on exactly one invoice in a cycle, so debtors in cycle order are the
    // parties in cycle order.
    const partyAddresses = [...new Set(cycleInvoices.map((e) => e.debtor.toLowerCase()))];

    // Parties load one at a time (each already fans out to three explorer requests) to stay
    // well clear of the explorer's rate limit.
    const parties: AddressSignals[] = [];
    for (const address of partyAddresses) {
      parties.push(await loadAddressSignals(address, known, registryLogs));
    }

    const earliestRegister = cycleInvoices.reduce<RegisteredWithBlock | null>(
      (min, e) => (!min || e.blockNumber < min.blockNumber ? e : min),
      null,
    );
    const partiesIncomplete = cycleInvoices.length !== nettedIds.length;
    const [earliestRegisterAt, settleAt] = await Promise.all([
      earliestRegister && !partiesIncomplete ? fetchTransactionTimestamp(earliestRegister.registerTxHash) : Promise.resolve(null),
      fetchTransactionTimestamp(settleTxHash),
    ]);

    return cycleSignals(parties, nettedIds.length, earliestRegisterAt, settleAt, partiesIncomplete);
  });
}
