"use server";

/// Server Actions behind `/app/demo` — thin wrappers around the already-tested `app/src/`
/// functions. Never imported by client-bundled code; the operator private key this file
/// constructs a signer from must never reach the browser.

import { ARC_TESTNET_CHAIN_ID, addressesForChain } from "@/src/contracts/addresses";
import { registerInvoice, ComplianceRejectedError } from "@/src/actions/register";
import { proposeSettlement, settleBestCycle, NoSettleableCycleError } from "@/src/actions/settle";
import { computeDashboardTiles } from "@/src/receipt/dashboardTiles";
import { getInvoice } from "@/src/chain/readInvoices";
import { signAttestation } from "@/src/attest/signAttestation";
import { buildDemoCycleInvoices } from "@/src/fixtures/demoCycle";
import { deriveDemoParties, MIN_DEMO_PARTIES, MAX_DEMO_PARTIES } from "@/src/fixtures/demoIdentities";
import {
  DEMO_RUN_EXPIRED_MESSAGE,
  DEMO_RUN_UNAVAILABLE_MESSAGE,
  demoRunIdsMatch,
  loadDemoRunInvoiceIds,
  rememberDemoRunInvoiceId,
} from "@/src/demo/runIds";
import { operatorSigner, arcPublicClient as publicClient } from "@/src/chain/operatorEnv";
import { upsertRegisteredInvoice, upsertSettledInvoice, upsertSettlement } from "@/src/db/invoices";
import { requestIp } from "@/src/ratelimit/requestIp";
import {
  claimDemoSpend,
  completeDemoSpend,
  DEMO_REGISTER_TRANSACTION_LIMITS,
  DEMO_SETTLE_TRANSACTION_LIMITS,
  inspectDemoSpend,
} from "@/src/demo/spendBudget";

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

/// A step that already ran returns its stored result. Its invoice ID is recorded again so the
/// settle step can bind to it even if the first recording was lost.
async function replayRegisterStep(runSalt: string, stored: unknown): Promise<RegisterStepResult> {
  const prior = stored as RegisterStepResult;
  if (prior.ok) await rememberDemoRunInvoiceId(runSalt, prior.invoice.invoiceId);
  return prior;
}

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
    if (!runSalt || runSalt.length > 128) throw new Error("Invalid demo run id");
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= partyCount) {
      throw new Error("Invalid demo invoice step");
    }

    const operationId = `register:${partyCount}:${stepIndex}:${runSalt}`;
    const previous = await inspectDemoSpend(operationId);
    if (previous.kind === "complete") return replayRegisterStep(runSalt, previous.result);
    if (previous.kind === "pending") return { ok: false, error: "This demo step is already being processed. Start a new demo if it does not finish." };
    if (previous.kind === "unavailable") return { ok: false, error: "Demo spending controls are unavailable. Try again later." };

    const client = publicClient();
    const signer = operatorSigner();
    if (signer.kind !== "raw-key") throw new Error("Demo spending requires the capped raw-key signer");
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

    const claim = await claimDemoSpend({
      operationId,
      callerIp: await requestIp(),
      limits: DEMO_REGISTER_TRANSACTION_LIMITS,
    });
    if (claim.kind === "complete") return replayRegisterStep(runSalt, claim.result);
    if (claim.kind !== "reserved") {
      return { ok: false, error: demoSpendError(claim.kind) };
    }

    const { invoiceId, txHash } = await registerInvoice({
      publicClient: client,
      signer,
      registry,
      invoice: invoice.attestation,
      debtorSignature,
      creditorSignature,
      transactionLimits: DEMO_REGISTER_TRANSACTION_LIMITS,
    });

    // Write-through to the database — deliberately isolated from this action's own
    // success/failure: a DB write failing here must never turn a real, already-broadcast,
    // already-paid-for chain write into a reported failure. This matters concretely: a database
    // connection can drop at any time, so putting the DB write inside the same try/catch as the chain
    // call would let a transient DB hiccup after a *successful* register() report the whole step as
    // failed. Reconciliation
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

    const result: RegisterStepResult = {
      ok: true,
      invoice: { label: invoice.label, amountUsdc: invoice.amountUsdc, invoiceId, txHash, explorerUrl: explorerTxUrl(txHash) },
    };
    await rememberDemoRunInvoiceId(runSalt, invoiceId);
    try {
      await completeDemoSpend(claim.operationKey, result);
    } catch (cacheErr) {
      // The permanent pending claim still prevents duplicate spending. Preserve confirmed chain
      // success even if its replay result could not be cached.
      console.error("Demo registration result could not be cached:", cacheErr);
    }
    return result;
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/// No `faceValueUsdc` field here — `wNet * cycleLength` is "gross cancelled" (the receipt's
/// summary tile metric), not "total invoiced." They only coincide when every invoice's amount
/// happens to equal wNet, which isn't true once invoices carry unequal amounts — the client
/// computes "total invoiced" itself, from the amounts it
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
  gasPaidUsdc: string | null;
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
export async function settleProposedCycle(runSalt: string, invoiceIds: string[], labels: Record<string, string>): Promise<SettleActionResult> {
  try {
    if (!runSalt || runSalt.length > 128) throw new Error("Invalid demo run id");
    if (invoiceIds.length < MIN_DEMO_PARTIES || invoiceIds.length > MAX_DEMO_PARTIES) {
      throw new Error(`A demo cycle must contain ${MIN_DEMO_PARTIES}-${MAX_DEMO_PARTIES} invoices`);
    }
    if (invoiceIds.some((id) => !/^0x[0-9a-fA-F]{64}$/.test(id))) throw new Error("Invalid demo invoice id");

    const { registry, settler } = addressesForChain(ARC_TESTNET_CHAIN_ID);
    const recorded = await loadDemoRunInvoiceIds(runSalt);
    if (recorded.kind === "unavailable") throw new Error(DEMO_RUN_UNAVAILABLE_MESSAGE);
    if (recorded.kind === "missing") throw new Error(DEMO_RUN_EXPIRED_MESSAGE);
    const requestedIds = invoiceIds.map((id) => id.toLowerCase());
    if (!demoRunIdsMatch(recorded.ids, requestedIds)) {
      throw new Error("These invoices do not belong to this demo run");
    }

    const operationId = `settle:${runSalt}:${[...requestedIds].sort().join(":")}`;
    const previous = await inspectDemoSpend(operationId);
    if (previous.kind === "complete") return previous.result as SettleActionResult;
    if (previous.kind === "pending") return { ok: false, error: "This demo settlement is already being processed. Check the chain before starting another demo." };
    if (previous.kind === "unavailable") return { ok: false, error: "Demo spending controls are unavailable. Try again later." };

    const client = publicClient();
    // Avoid reserving a paid settlement slot for a caller-supplied list that currently has no
    // settleable cycle. settleBestCycle re-derives the call immediately before broadcasting.
    const proposal = await proposeSettlement({
      publicClient: client,
      registry,
      invoiceIds: invoiceIds as `0x${string}`[],
    });
    if (!proposal) return { ok: false, error: "No settleable cycle among these invoices yet." };

    const claim = await claimDemoSpend({
      operationId,
      callerIp: await requestIp(),
      limits: DEMO_SETTLE_TRANSACTION_LIMITS,
    });
    if (claim.kind === "complete") return claim.result as SettleActionResult;
    if (claim.kind !== "reserved") return { ok: false, error: demoSpendError(claim.kind) };

    const signer = operatorSigner();
    if (signer.kind !== "raw-key") throw new Error("Demo spending requires the capped raw-key signer");

    const result = await settleBestCycle({
      publicClient: client,
      signer,
      registry,
      settler,
      invoiceIds: invoiceIds as `0x${string}`[],
      transactionLimits: DEMO_SETTLE_TRANSACTION_LIMITS,
    });

    const tiles = computeDashboardTiles(result);

    // Real post-settle on-chain state per invoice, not assumed — "before" is derived via the
    // formula (before = remainingAfter + wNet), matching how a receipt reconstructed purely from
    // chain events would compute it.
    const perInvoice: ReceiptInvoiceRow[] = await Promise.all(
      result.invoiceIds.map(async (id) => {
        const onchain = await getInvoice(client, registry, id);
        const after = onchain?.amountRemaining ?? 0n;
        const before = after + result.wNet;
        const requestedLabel = labels && typeof labels === "object" ? labels[id] : undefined;
        return {
          label: typeof requestedLabel === "string" ? requestedLabel.slice(0, 160) : id,
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
        gasPaidWei: tiles.gasPaidWei?.toString() ?? null,
      });
    } catch (dbErr) {
      console.error("settle write-through failed (reconciliation will backfill):", dbErr);
    }

    const actionResult: SettleActionResult = {
      ok: true,
      result: {
        txHash: result.txHash,
        explorerUrl: explorerTxUrl(result.txHash),
        blockNumber: result.blockNumber.toString(),
        wNetUsdc: formatUsdc(result.wNet),
        grossCancelledUsdc: formatUsdc(tiles.grossCancelledUsdc),
        cashMovedUsdc: formatUsdc(tiles.cashMovedUsdc),
        multiplierLabel: tiles.multiplier === null ? "no cash moved" : `${tiles.multiplier.toFixed(1)}x`,
        gasPaidUsdc: tiles.gasPaidWei === null ? null : formatNativeUsdc(tiles.gasPaidWei),
        invoices: perInvoice,
      },
    };
    try {
      await completeDemoSpend(claim.operationKey, actionResult);
    } catch (cacheErr) {
      console.error("Demo settlement result could not be cached:", cacheErr);
    }
    return actionResult;
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function demoSpendError(kind: "rate_limited" | "budget_exceeded" | "unavailable" | "pending"): string {
  if (kind === "rate_limited") return "Too many demo transactions from this network. Try again shortly.";
  if (kind === "budget_exceeded") return "Today's demo transaction budget has been reached. Please try again tomorrow.";
  if (kind === "pending") return "This demo action is already being processed.";
  return "Demo spending controls are unavailable. Try again later.";
}
