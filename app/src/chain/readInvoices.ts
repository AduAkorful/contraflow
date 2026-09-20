/// Reads against `ContraflowRegistry`. Three things worth knowing before touching this file:
/// - `getInvoice` **reverts** `InvoiceNotFound(id)` for an unregistered id — it never returns a
///   zero-valued struct (confirmed live on testnet, `plans/03-live-testnet-e2e-tests.md`). Code
///   here maps that specific revert to `null`, and re-throws anything else.
/// - There is no on-chain view function for the per-pair nonce counter (`_lastNonce` is private,
///   no getter in the ABI) — the "next nonce to use" has to be derived by scanning
///   `InvoiceRegistered` events for that (debtor, creditor) pair and taking `max(nonce) + 1`.
/// - viem decodes **every** Solidity integer type (`uint8` through `uint256`) as a JS `bigint`,
///   not `number` — including `status` (an enum, backed by `uint8`) and `maturity` (`uint64`).
///   `getInvoice` below explicitly normalizes the raw decode rather than casting it straight to
///   `OnchainInvoice`, specifically to avoid a `bigint !== number` comparison on `status` that
///   would type-check but always be false at runtime.

import type { Address, PublicClient } from "viem";
import { contraflowRegistryAbi } from "../contracts/abi/index";
import type { InvoiceEdge } from "@contraflow/solver";

export enum InvoiceStatus {
  Active = 0,
  ExtinguishedOnchain = 1,
}

export interface OnchainInvoice {
  debtor: Address;
  maturity: bigint;
  earlyNetConsent: boolean;
  status: InvoiceStatus;
  creditor: Address;
  amountRemaining: bigint;
  nonce: bigint;
}

/// Shape of the raw tuple viem's `readContract` returns for `getInvoice`, before normalization —
/// every integer field, `status` included, decodes as `bigint`.
interface RawInvoice {
  debtor: Address;
  maturity: bigint;
  earlyNetConsent: boolean;
  status: bigint;
  creditor: Address;
  amountRemaining: bigint;
  nonce: bigint;
}

function normalizeInvoice(raw: RawInvoice): OnchainInvoice {
  return {
    debtor: raw.debtor,
    maturity: raw.maturity,
    earlyNetConsent: raw.earlyNetConsent,
    status: Number(raw.status) as InvoiceStatus,
    creditor: raw.creditor,
    amountRemaining: raw.amountRemaining,
    nonce: raw.nonce,
  };
}

function isInvoiceNotFoundRevert(error: unknown): boolean {
  // viem surfaces a custom-error revert with the error name nested in `.cause`/`.walk()`;
  // matching on the decoded error name string is the stable part of that shape across viem
  // versions, rather than reaching into its internal error-class hierarchy.
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("InvoiceNotFound");
}

export async function getInvoice(
  client: PublicClient,
  registry: Address,
  invoiceId: `0x${string}`,
): Promise<OnchainInvoice | null> {
  try {
    const result = await client.readContract({
      address: registry,
      abi: contraflowRegistryAbi,
      functionName: "getInvoice",
      args: [invoiceId],
    });
    return normalizeInvoice(result as unknown as RawInvoice);
  } catch (error) {
    if (isInvoiceNotFoundRevert(error)) return null;
    throw error;
  }
}

export function toInvoiceEdge(invoiceId: `0x${string}`, invoice: OnchainInvoice): InvoiceEdge {
  return {
    id: invoiceId,
    debtor: invoice.debtor,
    creditor: invoice.creditor,
    amountRemaining: invoice.amountRemaining,
  };
}

/// Fetches multiple invoices by id and maps the found ones straight to the solver's
/// `InvoiceEdge[]` shape. Ids that revert `InvoiceNotFound` are silently dropped rather than
/// failing the whole batch — callers that need to know about a missing id (e.g. before
/// submitting a `settle()`) should call `getInvoice` directly for that one id instead.
export async function fetchInvoiceEdges(
  client: PublicClient,
  registry: Address,
  invoiceIds: readonly `0x${string}`[],
): Promise<InvoiceEdge[]> {
  const results = await Promise.all(invoiceIds.map((id) => getInvoice(client, registry, id)));
  const edges: InvoiceEdge[] = [];
  for (let i = 0; i < invoiceIds.length; i++) {
    const invoice = results[i];
    const id = invoiceIds[i];
    if (invoice && id) edges.push(toInvoiceEdge(id, invoice));
  }
  return edges;
}

/// Mirrors `ContraflowRegistry.netInvoice`'s own eligibility check: an invoice can only be
/// netted if it's still `Active` and either matured or its signer pre-consented to early
/// netting. Filtering with this *before* calling the solver avoids proposing a cycle that
/// `settle()` would revert on `InvoiceNotNettable`/`InvoiceNotActive` for a reason the app could
/// have caught client-side first.
export function isNettable(invoice: OnchainInvoice, nowUnixSeconds: bigint): boolean {
  if (invoice.status !== InvoiceStatus.Active) return false;
  return invoice.earlyNetConsent || nowUnixSeconds >= invoice.maturity;
}

/// Same as `fetchInvoiceEdges`, but drops invoices that aren't currently nettable per
/// `isNettable` above — the shape the solver should actually be fed.
export async function fetchNettableInvoiceEdges(
  client: PublicClient,
  registry: Address,
  invoiceIds: readonly `0x${string}`[],
  nowUnixSeconds: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Promise<InvoiceEdge[]> {
  const results = await Promise.all(invoiceIds.map((id) => getInvoice(client, registry, id)));
  const edges: InvoiceEdge[] = [];
  for (let i = 0; i < invoiceIds.length; i++) {
    const invoice = results[i];
    const id = invoiceIds[i];
    if (invoice && id && isNettable(invoice, nowUnixSeconds)) edges.push(toInvoiceEdge(id, invoice));
  }
  return edges;
}

/// The next nonce `register()` will accept for this (debtor, creditor) pair — the registry
/// requires the exact next sequential value, never merely-increasing (see the 2026-09-18 audit
/// correction). Derived from `InvoiceRegistered` event history since there's no direct getter.
export async function readNextNonce(
  client: PublicClient,
  registry: Address,
  debtor: Address,
  creditor: Address,
  opts?: { fromBlock?: bigint },
): Promise<bigint> {
  const logs = await client.getContractEvents({
    address: registry,
    abi: contraflowRegistryAbi,
    eventName: "InvoiceRegistered",
    args: { debtor, creditor },
    fromBlock: opts?.fromBlock ?? 0n,
    toBlock: "latest",
  });

  let maxNonce = 0n;
  for (const log of logs) {
    // The imported ABI JSON isn't a narrow-enough literal type for viem to discriminate
    // `args` by `eventName` at the type level, even though it's correct at runtime (the
    // integration test's live register()/read round-trip exercises this path for real).
    const nonce = (log as unknown as { args: { nonce?: bigint } }).args.nonce;
    if (nonce !== undefined && nonce > maxNonce) maxNonce = nonce;
  }
  return maxNonce + 1n;
}
