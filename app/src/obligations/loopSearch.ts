/// Finding the netting loop to propose for one party. Pure: the caller supplies the candidate
/// obligations (already filtered to one ledger and not locked) and the parties to exclude.
///
/// The search only looks at the caller's neighbourhood: the parties that could sit on a loop of
/// at most `MAX_LOOP_LENGTH` through the caller. That keeps unrelated parties from using up the
/// solver's vertex cap. If the neighbourhood is still over the cap, that currency fails closed:
/// it is reported, never searched in part.

import { buildGraph, findCycles, GraphTooLargeError, wNetOf, type InvoiceEdge } from "@contraflow/solver";
import type { Address, Hex } from "viem";
import { loopShapeProblem } from "../netting/certificate";
import { MAX_LOOP_LENGTH, MIN_LOOP_LENGTH } from "../netting/domain";

export interface CandidateObligation {
  obligationId: Hex;
  debtor: Address;
  creditor: Address;
  currency: string;
  remaining: bigint;
  /// Unix seconds.
  maturity: bigint;
  earlyNetConsent: boolean;
}

/// The solver's own hard cap, applied to the neighbourhood.
export const SEARCH_MAX_VERTICES = 32;
/// Enough for every loop in a 32-party neighbourhood in practice. Hitting it can only make the
/// chosen loop smaller than the best, never invalid.
const SEARCH_MAX_CYCLES = 500;

export type LoopSearchResult =
  | { kind: "found"; currency: string; wNet: bigint; loop: CandidateObligation[] }
  | { kind: "none" }
  | { kind: "too-many-parties"; currency: string; parties: number };

export function isNettableNow(o: CandidateObligation, now: bigint): boolean {
  return o.remaining > 0n && (o.maturity <= now || o.earlyNetConsent);
}

const lower = (a: string) => a.toLowerCase() as Address;

function distancesFrom(start: Address, edges: readonly CandidateObligation[], forward: boolean, maxDepth: number) {
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

/// The obligations that can lie on a loop of at most `maxLength` through `caller`: an edge u→v
/// qualifies when caller→u, then u→v, then v→caller fits in `maxLength` steps.
export function neighbourhoodEdges(
  edges: readonly CandidateObligation[],
  caller: Address,
  maxLength = MAX_LOOP_LENGTH,
): CandidateObligation[] {
  const me = lower(caller);
  const fromCaller = distancesFrom(me, edges, true, maxLength - 1);
  const toCaller = distancesFrom(me, edges, false, maxLength - 1);
  return edges.filter((e) => {
    const out = fromCaller.get(lower(e.debtor));
    const back = toCaller.get(lower(e.creditor));
    return out !== undefined && back !== undefined && out + 1 + back <= maxLength;
  });
}

function partiesOf(edges: readonly CandidateObligation[]): Set<Address> {
  return new Set(edges.flatMap((e) => [lower(e.debtor), lower(e.creditor)]));
}

/// Every party the search could reach for `caller`, across currencies: what needs screening.
export function neighbourhoodParties(candidates: readonly CandidateObligation[], caller: Address, now: bigint): Set<Address> {
  const parties = new Set<Address>();
  for (const edges of byCurrency(candidates.filter((c) => isNettableNow(c, now))).values()) {
    for (const p of partiesOf(neighbourhoodEdges(edges, caller))) parties.add(p);
  }
  return parties;
}

function byCurrency(candidates: readonly CandidateObligation[]): Map<string, CandidateObligation[]> {
  const groups = new Map<string, CandidateObligation[]>();
  for (const c of candidates) {
    if (!groups.has(c.currency)) groups.set(c.currency, []);
    groups.get(c.currency)!.push(c);
  }
  return groups;
}

/// The loop through `caller` with the largest `wNet`. Currencies are tried in code order and the
/// first currency with a loop wins, so repeated searches are deterministic; once that loop's
/// obligations are locked, the next search moves on.
export function findBestLoop(
  candidates: readonly CandidateObligation[],
  caller: Address,
  options: { now: bigint; excludedParties?: ReadonlySet<Address> },
): LoopSearchResult {
  const me = lower(caller);
  const excluded = new Set([...(options.excludedParties ?? [])].map(lower));
  const usable = candidates.filter(
    (c) => isNettableNow(c, options.now) && !excluded.has(lower(c.debtor)) && !excluded.has(lower(c.creditor)),
  );

  let tooMany: LoopSearchResult | null = null;
  const groups = byCurrency(usable);
  for (const currency of [...groups.keys()].sort()) {
    const edges = neighbourhoodEdges(groups.get(currency)!, me);
    if (edges.length === 0) continue;
    const parties = partiesOf(edges);
    if (parties.size > SEARCH_MAX_VERTICES) {
      tooMany ??= { kind: "too-many-parties", currency, parties: parties.size };
      continue;
    }

    const byId = new Map(edges.map((e) => [e.obligationId.toLowerCase(), e]));
    const solverEdges: InvoiceEdge[] = edges.map((e) => ({
      id: e.obligationId.toLowerCase() as Hex,
      debtor: lower(e.debtor),
      creditor: lower(e.creditor),
      amountRemaining: e.remaining,
    }));
    let cycles;
    try {
      cycles = findCycles(buildGraph(solverEdges), {
        maxVertices: SEARCH_MAX_VERTICES,
        minCycleLength: MIN_LOOP_LENGTH,
        maxCycleLength: MAX_LOOP_LENGTH,
        maxCycles: SEARCH_MAX_CYCLES,
        requireDistinctParties: true,
      });
    } catch (error) {
      if (error instanceof GraphTooLargeError) {
        tooMany ??= { kind: "too-many-parties", currency, parties: parties.size };
        continue;
      }
      throw error;
    }

    let best: { wNet: bigint; loop: CandidateObligation[] } | null = null;
    for (const cycle of cycles) {
      if (!cycle.edges.some((e) => e.debtor === me)) continue;
      if (loopShapeProblem(cycle.edges)) continue;
      const wNet = wNetOf(cycle);
      if (wNet <= 0n) continue;
      if (!best || wNet > best.wNet) best = { wNet, loop: cycle.edges.map((e) => byId.get(e.id)!) };
    }
    if (best) return { kind: "found", currency, wNet: best.wNet, loop: best.loop };
  }
  return tooMany ?? { kind: "none" };
}
