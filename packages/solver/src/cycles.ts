import type { Address, Cycle, Graph, InvoiceEdge, InvoiceId } from "./types.js";

export class GraphTooLargeError extends Error {
  constructor(vertexCount: number, maxVertices: number) {
    super(`graph has ${vertexCount} vertices, exceeds the hard cap of ${maxVertices} (spec §3.3: "cap exists so Johnson cannot explode")`);
    this.name = "GraphTooLargeError";
  }
}

export interface FindCyclesOptions {
  /** Spec §3.3 hard cap. Throws GraphTooLargeError if exceeded — a safety guard, not a soft
   * target, so callers must pre-screen rather than rely on silent truncation. */
  maxVertices?: number;
  minCycleLength?: number;
  maxCycleLength?: number;
  maxCycles?: number;
  /** Only return loops in which every party appears once, as both `ContraflowSettler.settle()`
   * and `ContraflowNettingLedger.applyCertificate()` require (`DuplicateParty`). Pruned during
   * the search, so `maxCycles` isn't spent on walks that could never be applied. */
  requireDistinctParties?: boolean;
  /** Only enumerate cycles rooted at this party. Every emitted cycle contains it, so unrelated
   * inner cycles cannot consume a caller's maxCycles output budget. */
  requiredParty?: Address;
}

const DEFAULT_MAX_VERTICES = 32;
const DEFAULT_MIN_CYCLE_LENGTH = 3;
const DEFAULT_MAX_CYCLE_LENGTH = 5;
const DEFAULT_MAX_CYCLES = 100;

/** Tarjan's SCC algorithm. Returns each strongly-connected component's vertex set. Any closed walk —
 * including the repeated-party walks enumerated below by default — can only exist
 * entirely within a single SCC, so this is the pruning pass before cycle enumeration, per spec
 * §3.3, regardless of how "cycle" ends up defined for enumeration purposes. */
function tarjanSCC(vertices: Address[], adjacency: Map<Address, Address[]>): Address[][] {
  let index = 0;
  const indices = new Map<Address, number>();
  const lowlink = new Map<Address, number>();
  const onStack = new Set<Address>();
  const stack: Address[] = [];
  const result: Address[][] = [];

  function strongConnect(v: Address): void {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: Address[] = [];
      let w: Address;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      result.push(component);
    }
  }

  for (const v of vertices) {
    if (!indices.has(v)) strongConnect(v);
  }
  return result;
}

/**
 * By default this enumerates closed walks of *distinct edges* (vertices may repeat), bounded to
 * [minLen, maxLen]: `edges[i].creditor == edges[i+1].debtor` around the array, with every
 * invoice id distinct. That is looser than what the contracts accept today: both
 * `ContraflowSettler.settle()` and the netting ledger also revert `DuplicateParty` when a party
 * appears twice (A→B, B→A, A→B, B→A is four distinct invoices between the same two addresses,
 * and is rejected). Callers proposing an onchain call must pass `requireDistinctParties`, which
 * restricts the search to elementary cycles.
 */
function enumerateClosedWalksInComponent(
  component: Set<Address>,
  edgesByDebtor: Map<Address, InvoiceEdge[]>,
  minLen: number,
  maxLen: number,
  maxCycles: number,
  requireDistinctParties: boolean,
  requiredParty: Address | undefined,
  seenCanonical: Set<string>,
  out: Cycle[],
): void {
  const startingEdges = [...component]
    .flatMap((v) => edgesByDebtor.get(v) ?? [])
    .filter((e) => component.has(e.creditor) && (!requiredParty || e.debtor === requiredParty));

  for (const first of startingEdges) {
    if (out.length >= maxCycles) return;

    const path: InvoiceEdge[] = [first];
    const usedIds = new Set<InvoiceId>([first.id]);
    const visited = new Set<Address>([first.debtor, first.creditor]);

    dfs(first.creditor);

    function dfs(current: Address): void {
      if (out.length >= maxCycles) return;

      if (current === first.debtor && path.length >= minLen && path.length <= maxLen) {
        recordIfNew(path);
      }
      // Walking on from the start would revisit it.
      if (requireDistinctParties && current === first.debtor) return;
      if (path.length >= maxLen) return;

      for (const edge of edgesByDebtor.get(current) ?? []) {
        if (out.length >= maxCycles) return;
        if (!component.has(edge.creditor)) continue;
        if (usedIds.has(edge.id)) continue;
        const revisits = edge.creditor !== first.debtor && visited.has(edge.creditor);
        if (requireDistinctParties && revisits) continue;

        const added = !visited.has(edge.creditor);
        usedIds.add(edge.id);
        if (added) visited.add(edge.creditor);
        path.push(edge);
        dfs(edge.creditor);
        path.pop();
        if (added) visited.delete(edge.creditor);
        usedIds.delete(edge.id);
      }
    }
  }

  function recordIfNew(path: InvoiceEdge[]): void {
    // Canonicalize by rotating to start at the lexicographically-smallest invoice id, so the
    // same closed walk found via a different starting edge (a rotation of the same cycle)
    // isn't counted twice.
    let minIdx = 0;
    for (let i = 1; i < path.length; i++) {
      if (path[i]!.id < path[minIdx]!.id) minIdx = i;
    }
    const rotated = [...path.slice(minIdx), ...path.slice(0, minIdx)];
    const key = rotated.map((e) => e.id).join(",");
    if (seenCanonical.has(key)) return;
    seenCanonical.add(key);
    out.push({ edges: rotated });
  }
}

export function findCycles(graph: Graph, opts: FindCyclesOptions = {}): Cycle[] {
  const maxVertices = opts.maxVertices ?? DEFAULT_MAX_VERTICES;
  const minLen = opts.minCycleLength ?? DEFAULT_MIN_CYCLE_LENGTH;
  const maxLen = opts.maxCycleLength ?? DEFAULT_MAX_CYCLE_LENGTH;
  const maxCycles = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
  const requireDistinctParties = opts.requireDistinctParties ?? false;
  const requiredParty = opts.requiredParty;

  if (graph.vertices.length > maxVertices) {
    throw new GraphTooLargeError(graph.vertices.length, maxVertices);
  }

  const edgesByDebtor = new Map<Address, InvoiceEdge[]>();
  const adjacency = new Map<Address, Address[]>();
  for (const edge of graph.edges) {
    if (!edgesByDebtor.has(edge.debtor)) edgesByDebtor.set(edge.debtor, []);
    edgesByDebtor.get(edge.debtor)!.push(edge);
    if (!adjacency.has(edge.debtor)) adjacency.set(edge.debtor, []);
    adjacency.get(edge.debtor)!.push(edge.creditor);
  }

  const components = tarjanSCC(graph.vertices, adjacency);
  const results: Cycle[] = [];
  const seenCanonical = new Set<string>();

  for (const component of components) {
    if (component.length < 2) continue; // a single-vertex SCC can't host any cycle (no self-invoices)
    if (results.length >= maxCycles) break;
    enumerateClosedWalksInComponent(
      new Set(component),
      edgesByDebtor,
      minLen,
      maxLen,
      maxCycles,
      requireDistinctParties,
      requiredParty,
      seenCanonical,
      results,
    );
  }

  return results;
}
