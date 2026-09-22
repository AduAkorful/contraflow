/// Builds a closed ring of invoices among N demo parties (party[i] owes party[i+1], wrapping) —
/// the general form of the 3-node ads fixture (`fixtures/ads.ts`), extended to a configurable
/// party count and unequal amounts per edge. Kept separate from `ads.ts` rather than
/// generalizing it in place: `ads.ts`'s fixed 3-role shape (`FixtureRole`,
/// `FixtureRoleAddresses`) is the canonical documented fixture and other code
/// (`registerFixtureInvoices`) depends on that exact shape — this module doesn't touch it.
///
/// Every edge uses a fresh party pair by construction (each demo party appears as debtor exactly
/// once and creditor exactly once in a simple ring), so — same reasoning as
/// `fixtures/demoIdentities.ts` — every invoice's nonce is always 1. No on-chain nonce scan is
/// needed at all for this path, which is even cheaper than the 3-node fixture's original design.
///
/// Amounts are unequal on purpose, not a cosmetic randomization: `ContraflowSettler.settle`
/// applies one `wNet` uniformly to every invoice in the cycle, and the solver computes
/// `wNet = min(amountRemaining)` over the cycle's edges (`packages/solver/src/settleCall.ts`) —
/// not an average or a requirement that every invoice matches. Equal amounts (the
/// original design) made every invoice in the demo fully extinguish, which is a real but
/// degenerate case; unequal amounts show the actually-general case, where only the
/// smallest-remaining invoice zeroes out and the rest keep a genuine nonzero remainder — visible
/// in the receipt's per-invoice before/after rows.

import { keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import type { InvoiceAttestation } from "../attest/signAttestation";
import type { DemoParty } from "./demoIdentities";

const USDC_DECIMALS = 6;
const DEFAULT_MATURITY_OFFSET_SECONDS = 30n * 24n * 60n * 60n;

/// Deliberately a wide, clearly-unequal spread rather than a narrow one — the point is to make
/// partial netting visible (some invoices reduce to a nonzero remainder, not just to zero), which
/// a near-uniform range would obscure most of the time.
export const DEMO_MIN_AMOUNT_USDC = 500;
export const DEMO_MAX_AMOUNT_USDC = 3000;
const DEMO_AMOUNT_STEP_USDC = 50;

/// Deterministic per-(runSalt, edge index) amount, same reasoning as
/// `demoIdentities.ts`'s address derivation: reproducible for a given run (useful for debugging a
/// specific run's outcome) without needing `Math.random()` or any client/server state beyond the
/// salt. Safe to call from client code too (no secrets involved) so the UI can preview an edge's
/// real amount before that invoice has actually registered.
export function demoEdgeAmountUsdc(index: number, runSalt: string): number {
  const hash = keccak256(toHex(`contraflow-demo-amount-${index}-${runSalt}`));
  const steps = (DEMO_MAX_AMOUNT_USDC - DEMO_MIN_AMOUNT_USDC) / DEMO_AMOUNT_STEP_USDC;
  const stepIndex = Number(BigInt(hash) % BigInt(steps + 1));
  return DEMO_MIN_AMOUNT_USDC + stepIndex * DEMO_AMOUNT_STEP_USDC;
}

export interface DemoCycleInvoice {
  label: string;
  amountUsdc: string;
  attestation: InvoiceAttestation;
  debtor: DemoParty;
  creditor: DemoParty;
}

export function buildDemoCycleInvoices(params: {
  parties: DemoParty[];
  runSalt: string;
  currency: Address;
  registry: Address;
  chainId: bigint;
  nowUnixSeconds?: bigint;
}): DemoCycleInvoice[] {
  const { parties, runSalt, currency, registry, chainId } = params;
  const n = parties.length;
  const now = params.nowUnixSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  const maturity = now + DEFAULT_MATURITY_OFFSET_SECONDS;

  return parties.map((debtor, i) => {
    const creditor = parties[(i + 1) % n]!;
    const invoiceRef: Hex = keccak256(toHex(`contraflow-demo-cycle:${debtor.address}:${creditor.address}`));
    const amountUsdc = String(demoEdgeAmountUsdc(i, runSalt));

    const attestation: InvoiceAttestation = {
      invoiceRef,
      amount: parseUnits(amountUsdc, USDC_DECIMALS),
      currency,
      maturity,
      earlyNetConsent: true,
      debtor: debtor.address,
      creditor: creditor.address,
      nonce: 1n,
      registry,
      chainId,
    };

    return { label: `${debtor.label} → ${creditor.label}`, amountUsdc, attestation, debtor, creditor };
  });
}
