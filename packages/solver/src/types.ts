export type Address = `0x${string}`;
export type InvoiceId = `0x${string}`;

/** Mirrors ContraflowRegistry.Invoice's economically-relevant fields, not the full on-chain
 * struct — maturity/earlyNetConsent/status/nonce are the caller's job to have already filtered
 * on (e.g. only pass Active, currently-nettable invoices in). */
export interface InvoiceEdge {
  id: InvoiceId;
  debtor: Address;
  creditor: Address;
  /** 6-decimal USDC, matches ContraflowRegistry.Invoice.amountRemaining exactly. */
  amountRemaining: bigint;
}

export interface Graph {
  vertices: Address[];
  edges: InvoiceEdge[];
}

/** A simple (elementary) directed cycle: edges[i].creditor === edges[i+1].debtor for every i,
 * wrapping from the last edge back to the first. */
export interface Cycle {
  edges: InvoiceEdge[];
}

export interface SettleCall {
  invoiceIds: InvoiceId[];
  wNet: bigint;
}
