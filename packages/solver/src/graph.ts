import type { Address, Graph, InvoiceEdge } from "./types.js";

/** Builds a directed multigraph from a flat list of invoice edges. Vertices are the deduped
 * set of every address appearing as a debtor or creditor. Pure — does no filtering of its own;
 * callers decide which invoices (Active, currently-nettable, screened, etc.) to pass in. */
export function buildGraph(invoices: InvoiceEdge[]): Graph {
  const vertexSet = new Set<Address>();
  for (const inv of invoices) {
    vertexSet.add(inv.debtor);
    vertexSet.add(inv.creditor);
  }
  return {
    vertices: [...vertexSet],
    edges: [...invoices],
  };
}
