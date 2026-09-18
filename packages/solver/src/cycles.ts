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
}

const DEFAULT_MAX_VERTICES = 32;
const DEFAULT_MIN_CYCLE_LENGTH = 3;
const DEFAULT_MAX_CYCLE_LENGTH = 5;
const DEFAULT_MAX_CYCLES = 100;

/** Tarjan's SCC algorithm. Returns each strongly-connected component's vertex set. Any cycle —
 * in ContraflowSettler's actual, looser sense: see the module doc below — can only exist
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
 * IMPORTANT: "cycle" here means exactly what `ContraflowSettler.settle()` itself checks —
 * `invoiceIds[i].creditor == invoiceIds[i+1].debtor` around the array, wrapping at the end,
 * with every invoice id distinct (`DuplicateInvoiceId` on the contract side) — and nothing
 * more. It is **not** the graph-theory "elementary cycle" (no repeated vertex). Those differ:
 * A→B, B→A, A→B, B→A is four *distinct invoices* between the same two addresses, and the live
 * testnet campaign (plans/03-live-testnet-e2e-tests.md, SET-16) proved the deployed contract
 * accepts it as a valid settle() cycle today. An elementary-cycle-only search would silently
 * fail to propose a settle call the contract would happily accept — the solver must match the
 * contract's actual (looser) definition, not a textbook-stricter one. So this enumerates closed
 * walks of *distinct edges* (vertices may repeat), bounded to [minLen, maxLen].
 */
function enumerateClosedWalksInComponent(
  component: Set<Address>,
  edgesByDebtor: Map<Address, InvoiceEdge[]>,
  minLen: number,
  maxLen: number,
  maxCycles: number,
  seenCanonical: Set<string>,
  out: Cycle[],
): void {
  const startingEdges = [...component]
    .flatMap((v) => edgesByDebtor.get(v) ?? [])
    .filter((e) => component.has(e.creditor));

  for (const first of startingEdges) {
    if (out.length >= maxCycles) return;

    const path: InvoiceEdge[] = [first];
    const usedIds = new Set<InvoiceId>([first.id]);

    dfs(first.creditor);

    function dfs(current: Address): void {
      if (out.length >= maxCycles) return;

      if (current === first.debtor && path.length >= minLen && path.length <= maxLen) {
        recordIfNew(path);
      }
      if (path.length >= maxLen) return;

      for (const edge of edgesByDebtor.get(current) ?? []) {
        if (out.length >= maxCycles) return;
        if (!component.has(edge.creditor)) continue;
        if (usedIds.has(edge.id)) continue;

        usedIds.add(edge.id);
        path.push(edge);
        dfs(edge.creditor);
        path.pop();
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
    enumerateClosedWalksInComponent(new Set(component), edgesByDebtor, minLen, maxLen, maxCycles, seenCanonical, results);
  }

  return results;
}
