/// Caller-rooted invoice-loop search for Mode A `settle()`. History is read from the Registry's
/// event logs (bounded), candidates are re-read onchain, then the solver proposes a call. A
/// truncated log window never claims there is no loop.

import { proposeSettleCall, GraphTooLargeError, type InvoiceEdge } from "@contraflow/solver";
import type { Address, Hex } from "viem";
import type { DecodedLog } from "../blockscout/client";
import { parseRegistered } from "../blockscout/reconcile";

/// `ContraflowSettler.MIN_CYCLE_LENGTH` / `MAX_CYCLE_LENGTH`.
export const INVOICE_MIN_CYCLE_LENGTH = 3;
export const INVOICE_MAX_CYCLE_LENGTH = 5;
/// The solver's own hard cap, applied to the caller's neighbourhood.
export const INVOICE_SEARCH_MAX_VERTICES = 32;

export interface InvoiceLoopLeg {
  id: Hex;
  debtor: Address;
  creditor: Address;
  remaining: bigint;
}

export type InvoiceLoopResult =
  | { kind: "loop"; invoiceIds: Hex[]; wNet: bigint; legs: InvoiceLoopLeg[] }
  | { kind: "none" }
  | { kind: "incomplete" };

const lower = (a: string) => a.toLowerCase() as Address;

function distancesFrom(start: Address, edges: readonly InvoiceEdge[], forward: boolean, maxDepth: number) {
  const next = new Map<Address, Address[]>();
  for (const e of edges) {
    const [from, to] = forward ? [lower(e.debtor), lower(e.creditor)] : [lower(e.creditor), lower(e.debtor)];
    if (!next.has(from)) next.set(from, []);
    next.get(from)!.push(to);
  }
  const distance = new Map<Address, number>([[start, 0]]);
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const following: Address[] = [];
    for (const v of frontier) {
      for (const w of next.get(v) ?? []) {
        if (distance.has(w)) continue;
        distance.set(w, depth);
        following.push(w);
      }
    }
    frontier = following;
  }
  return distance;
}

export function neighbourhoodInvoiceEdges(
  edges: readonly InvoiceEdge[],
  caller: Address,
  maxLength = INVOICE_MAX_CYCLE_LENGTH,
): InvoiceEdge[] {
  const me = lower(caller);
  const fromCaller = distancesFrom(me, edges, true, maxLength - 1);
  const toCaller = distancesFrom(me, edges, false, maxLength - 1);
  return edges.filter((e) => {
    const out = fromCaller.get(lower(e.debtor));
    const back = toCaller.get(lower(e.creditor));
    return out !== undefined && back !== undefined && out + 1 + back <= maxLength;
  });
}

function partiesOf(edges: readonly InvoiceEdge[]): Set<Address> {
  return new Set(edges.flatMap((e) => [lower(e.debtor), lower(e.creditor)]));
}

export function registeredInvoiceEdges(logs: readonly DecodedLog[]): InvoiceEdge[] {
  const edges: InvoiceEdge[] = [];
  for (const log of logs) {
    const event = parseRegistered(log);
    if (!event) continue;
    if (!/^0x[0-9a-fA-F]{64}$/.test(event.invoiceRef)) continue;
    edges.push({
      id: event.invoiceRef.toLowerCase() as Hex,
      debtor: event.debtor as Address,
      creditor: event.creditor as Address,
      amountRemaining: event.amountBaseUnits,
    });
  }
  return edges;
}

export function proposeInvoiceLoop(edges: readonly InvoiceEdge[], caller: Address): InvoiceLoopResult {
  const me = lower(caller);
  // The solver compares addresses as exact strings, and onchain reads return checksummed ones,
  // so every edge is lowercased to match the lowercased caller.
  const neighbourhood = neighbourhoodInvoiceEdges(edges, me).map((e) => ({ ...e, debtor: lower(e.debtor), creditor: lower(e.creditor) }));
  if (neighbourhood.length === 0) return { kind: "none" };
  if (partiesOf(neighbourhood).size > INVOICE_SEARCH_MAX_VERTICES) return { kind: "incomplete" };

  let proposal;
  try {
    proposal = proposeSettleCall([...neighbourhood], {
      maxVertices: INVOICE_SEARCH_MAX_VERTICES,
      minCycleLength: INVOICE_MIN_CYCLE_LENGTH,
      maxCycleLength: INVOICE_MAX_CYCLE_LENGTH,
      requireDistinctParties: true,
      requiredParty: me,
    });
  } catch (error) {
    if (error instanceof GraphTooLargeError) return { kind: "incomplete" };
    throw error;
  }
  if (!proposal) return { kind: "none" };

  const byId = new Map(neighbourhood.map((e) => [e.id.toLowerCase(), e]));
  const legs: InvoiceLoopLeg[] = [];
  for (const id of proposal.invoiceIds) {
    const edge = byId.get(id.toLowerCase());
    if (!edge) return { kind: "incomplete" };
    legs.push({ id: edge.id, debtor: lower(edge.debtor), creditor: lower(edge.creditor), remaining: edge.amountRemaining });
  }
  if (!legs.some((leg) => leg.debtor === me || leg.creditor === me)) return { kind: "none" };
  return { kind: "loop", invoiceIds: proposal.invoiceIds, wNet: proposal.wNet, legs };
}

export interface FindInvoiceLoopDeps {
  fetchLogs: () => Promise<{ logs: DecodedLog[]; truncated: boolean }>;
  fetchNettable: (ids: Hex[]) => Promise<InvoiceEdge[]>;
  filterFlagged: (edges: InvoiceEdge[]) => Promise<InvoiceEdge[]>;
}

export async function findInvoiceLoopFor(party: Address, deps: FindInvoiceLoopDeps): Promise<InvoiceLoopResult> {
  const scan = await deps.fetchLogs();
  if (scan.truncated) return { kind: "incomplete" };

  const registered = registeredInvoiceEdges(scan.logs);
  const candidates = neighbourhoodInvoiceEdges(registered, party);
  if (candidates.length === 0) return { kind: "none" };

  const nettable = await deps.fetchNettable(candidates.map((e) => e.id));
  const clear = await deps.filterFlagged(nettable);
  return proposeInvoiceLoop(clear, party);
}
