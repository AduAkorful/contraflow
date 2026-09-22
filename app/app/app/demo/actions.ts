"use server";

/// Server Actions behind `/app/demo` (plans/16-app-demo.md, plans/17-app-demo-n-party.md,
/// plans/18-app-demo-unequal-amounts.md) — thin wrappers around the already-tested `app/src/`
/// functions. Never imported by client-bundled code; the operator private key this file
/// constructs a signer from must never reach the browser.

import { ARC_TESTNET_CHAIN_ID, addressesForChain } from "../../../src/contracts/addresses";
import { registerInvoice, ComplianceRejectedError } from "../../../src/actions/register";
import { proposeSettlement, settleBestCycle, NoSettleableCycleError } from "../../../src/actions/settle";
import { computeDashboardTiles } from "../../../src/receipt/dashboardTiles";
import { getInvoice } from "../../../src/chain/readInvoices";
import { signAttestation } from "../../../src/attest/signAttestation";
import { buildDemoCycleInvoices } from "../../../src/fixtures/demoCycle";
import { deriveDemoParties, MIN_DEMO_PARTIES, MAX_DEMO_PARTIES } from "../../../src/fixtures/demoIdentities";
import { operatorSigner, arcPublicClient as publicClient } from "../../../src/chain/operatorEnv";
import { upsertRegisteredInvoice, upsertSettledInvoice, upsertSettlement } from "../../../src/db/invoices";

const EXPLORER_BASE = "https://explorer.testnet.arc.io";

function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof ComplianceRejectedError) {
    return `Blocked by compliance screening: ${err.flagged.join(", ")}`;
  }
  if (err instanceof NoSettleableCycleError) {
    return "No settleable cycle among these invoices yet.";
  }
  return err instanceof Error ? err.message : String(err);
}

const USDC_DECIMALS = 6;
function formatUsdc(baseUnits: bigint): string {
  return (Number(baseUnits) / 10 ** USDC_DECIMALS).toFixed(2);
}

export interface RegisteredInvoiceView {
  label: string;
  amountUsdc: string;
  invoiceId: string;
  txHash: string;
  explorerUrl: string;
}

export type RegisterStepResult =
  | { ok: true; invoice: RegisteredInvoiceView }
  | { ok: false; error: string };

/// Registers exactly one invoice of an N-party closed cycle for real, live — called once per
/// party by the client, sequentially, so each real registration can be shown as it lands rather
/// than all at once at the end. `runSalt`/`partyCount` must be identical across all calls in one
/// demo run (generated once client-side) so they resolve to the same party addresses. No nonce
/// scan needed: see fixtures/demoCycle.ts's doc comment — every edge in a fresh N-party ring is
/// provably at nonce 1 by construction.
export async function registerCycleInvoiceStep(
  runSalt: string,
  partyCount: number,
  stepIndex: number,
): Promise<RegisterStepResult> {
  try {
    if (partyCount < MIN_DEMO_PARTIES || partyCount > MAX_DEMO_PARTIES) {
      throw new Error(`partyCount must be ${MIN_DEMO_PARTIES}-${MAX_DEMO_PARTIES}`);
    }
    const client = publicClient();
    const signer = operatorSigner();
    const { registry, usdc } = addressesForChain(ARC_TESTNET_CHAIN_ID);

    const parties = deriveDemoParties(runSalt, partyCount);
    const invoices = buildDemoCycleInvoices({
      parties,
      runSalt,
      currency: usdc,
      registry,
      chainId: BigInt(ARC_TESTNET_CHAIN_ID),
    });
    const invoice = invoices[stepIndex];
    if (!invoice) throw new Error(`registerCycleInvoiceStep: no invoice at index ${stepIndex}`);

    const { debtorSignature, creditorSignature } = await signAttestation(
      invoice.attestation,
      invoice.debtor.privateKey,
      invoice.creditor.privateKey,
    );

    const { invoiceId, txHash } = await registerInvoice({
      publicClient: client,
      signer,
      registry,
      invoice: invoice.attestation,
      debtorSignature,
      creditorSignature,
    });

    // Write-through to the database (plans/19-database-blockscout-reconciliation.md) —
    // deliberately isolated from this action's own success/failure: a DB write failing here must
    // never turn a real, already-broadcast, already-paid-for chain write into a reported failure.
    // Live-verified this actually happens: Neon's HTTP driver has a known intermittent
    // "TypeError: fetch failed" (a documented connection-drop issue, not specific to this app —
    // github.com/neondatabase/serverless/issues/146/127), and the first version of this write-through
    // put it inside the same try/catch as the chain call, so a transient DB hiccup after a
    // *successful* register() reported the whole step as failed. Reconciliation
    // (src/blockscout/reconcile.ts) exists precisely to backfill a write this call misses, so
    // swallowing the failure here (logged, not silent) is the correct tradeoff, not a shortcut.
    try {
      await upsertRegisteredInvoice({
        invoiceRef: invoiceId,
        debtor: invoice.attestation.debtor,
        creditor: invoice.attestation.creditor,
        amountUsdc: invoice.amountUsdc,
        maturity: invoice.attestation.maturity.toString(),
        earlyNetConsent: invoice.attestation.earlyNetConsent,
        registerTxHash: txHash,
      });
    } catch (dbErr) {
      console.error("upsertRegisteredInvoice failed (reconciliation will backfill):", dbErr);
    }

    return {
      ok: true,
      invoice: { label: invoice.label, amountUsdc: invoice.amountUsdc, invoiceId, txHash, explorerUrl: explorerTxUrl(txHash) },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/// No `faceValueUsdc` field here (it existed briefly, computed as `wNet * cycleLength`) — that's
/// actually "gross cancelled" (spec §9.2's own metric, correct for the receipt's summary tile),
/// not "total invoiced." They only coincide when every invoice's amount happens to equal wNet.
/// Now that demo invoices carry unequal amounts (plans/18-app-demo-unequal-amounts.md), the two
/// numbers really differ — the client computes "total invoiced" itself, from the amounts it
/// already has off each register step, rather than this action returning a same-named-but-wrong
/// value.
export interface CycleProposalView {
  invoiceIds: string[];
  wNetUsdc: string;
  cycleLength: number;
}

export type ProposeActionResult =
  | { ok: true; proposal: CycleProposalView | null }
  | { ok: false; error: string };

export async function proposeCycle(invoiceIds: string[]): Promise<ProposeActionResult> {
  try {
    const client = publicClient();
    const { registry } = addressesForChain(ARC_TESTNET_CHAIN_ID);

    const proposal = await proposeSettlement({
      publicClient: client,
      registry,
      invoiceIds: invoiceIds as `0x${string}`[],
    });

    if (!proposal) return { ok: true, proposal: null };

    return {
      ok: true,
      proposal: {
        invoiceIds: [...proposal.invoiceIds],
        wNetUsdc: formatUsdc(proposal.wNet),
        cycleLength: proposal.invoiceIds.length,
      },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export interface ReceiptInvoiceRow {
  label: string;
  invoiceId: string;
  beforeUsdc: string;
  afterUsdc: string;
}

export interface SettleResultView {
  txHash: string;
  explorerUrl: string;
  blockNumber: string;
  wNetUsdc: string;
  grossCancelledUsdc: string;
  cashMovedUsdc: string;
  multiplierLabel: string;
  gasPaidUsdc: string;
  invoices: ReceiptInvoiceRow[];
}

export type SettleActionResult =
  | { ok: true; result: SettleResultView }
  | { ok: false; error: string };

const NATIVE_USDC_DECIMALS = 18;
function formatNativeUsdc(wei: bigint): string {
  return (Number(wei) / 10 ** NATIVE_USDC_DECIMALS).toFixed(6);
}

/// `labels` maps invoiceId -> display label ("Northwind DSP → Meridian Exchange"), gathered
/// client-side from the register steps — the settle path itself only ever deals in invoice ids.
export async function settleProposedCycle(invoiceIds: string[], labels: Record<string, string>): Promise<SettleActionResult> {
  try {
    const client = publicClient();
    const signer = operatorSigner();
    const { registry, settler } = addressesForChain(ARC_TESTNET_CHAIN_ID);

    const result = await settleBestCycle({
      publicClient: client,
      signer,
      registry,
      settler,
      invoiceIds: invoiceIds as `0x${string}`[],
    });

    const tiles = computeDashboardTiles(result);

    // Real post-settle on-chain state per invoice, not assumed — "before" is derived via the
    // documented formula (before = remainingAfter + wNet), matching how a receipt reconstructed
    // purely from chain events would compute it (plans/14-app-shell-refactor.md's receipt section).
    const perInvoice: ReceiptInvoiceRow[] = await Promise.all(
      result.invoiceIds.map(async (id) => {
        const onchain = await getInvoice(client, registry, id);
        const after = onchain?.amountRemaining ?? 0n;
        const before = after + result.wNet;
        return {
          label: labels[id] ?? id,
          invoiceId: id,
          beforeUsdc: formatUsdc(before),
          afterUsdc: formatUsdc(after),
        };
      }),
    );

    // Write-through, deliberately isolated from this action's success/failure — same rationale
    // and same live-verified reason as registerCycleInvoiceStep above: a settle() that already
    // succeeded and already cost real gas must never be reported as failed because of an
    // unrelated, transient DB hiccup. Confirmed live this session: a settle tx landed
    // successfully on-chain while this exact write-through's first version (inside the try block,
    // no isolation) reported the whole action as failed to the UI.
    try {
      for (const row of perInvoice) {
        await upsertSettledInvoice({
          invoiceRef: row.invoiceId,
          settleTxHash: result.txHash,
          wNetUsdc: formatUsdc(result.wNet),
          remainingUsdc: row.afterUsdc,
        });
      }
      await upsertSettlement({
        settleTxHash: result.txHash,
        blockNumber: result.blockNumber.toString(),
        wNetUsdc: formatUsdc(result.wNet),
        cycleLength: result.invoiceIds.length,
        gasPaidWei: tiles.gasPaidWei.toString(),
      });
    } catch (dbErr) {
      console.error("settle write-through failed (reconciliation will backfill):", dbErr);
    }

    return {
      ok: true,
      result: {
        txHash: result.txHash,
        explorerUrl: explorerTxUrl(result.txHash),
        blockNumber: result.blockNumber.toString(),
        wNetUsdc: formatUsdc(result.wNet),
        grossCancelledUsdc: formatUsdc(tiles.grossCancelledUsdc),
        cashMovedUsdc: formatUsdc(tiles.cashMovedUsdc),
        multiplierLabel: tiles.multiplier === null ? "no cash moved" : `${tiles.multiplier.toFixed(1)}x`,
        gasPaidUsdc: formatNativeUsdc(tiles.gasPaidWei),
        invoices: perInvoice,
      },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
