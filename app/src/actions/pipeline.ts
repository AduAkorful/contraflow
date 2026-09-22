/// Top-level orchestration: register a set of invoices, settle the best cycle among them, and
/// optionally quote/fund a residual for whatever's left dangling (no cycle reached them).
///
/// "Residual" here is *not* a settle() byproduct — settle() always fully extinguishes whatever
/// cycle it's given (same-asset in-place cancel only), so there's never a partial leftover
/// on an invoice that was part of the settled cycle. A residual is an invoice that no cycle
/// reached at all. Funding one just lands USDC on the operator's Arc balance (via the existing,
/// independently-proven Unified Balance path) — nothing in this protocol pays an invoice down
/// with it; that's outside this pipeline's job.
///
/// register()/settle() are irreversible once landed on-chain, so this function does not throw on
/// a downstream (residual) failure once those two have already succeeded — it returns a result
/// reporting what completed, including a resumable error for the caller to act on.

import type { Address, Hex, PublicClient } from "viem";
import type { SwapEstimate, UnifiedBalanceChain } from "@circle-fin/app-kit";

import { signAttestation, type InvoiceAttestation } from "../attest/signAttestation";
import { registerInvoice, type RegisterResult } from "./register";
import { settleBestCycle, NoSettleableCycleError, type SettleResult } from "./settle";
import { computeDashboardTiles, type DashboardTiles } from "../receipt/dashboardTiles";
import type { ComplianceProvider } from "../compliance";
import type { OperatorSigner } from "../operator/signer";
import type { ContraflowAppKitAdapter, ContraflowSwapKit } from "../kits/appkit";
import { estimateUsdcToEurcSwap } from "../kits/swap";
import { fundResidualViaGateway, GatewayFundResidualPartialFailureError } from "../kits/unifiedBalance";

export interface PendingInvoice {
  invoice: InvoiceAttestation;
  debtorPrivateKey: Hex;
  creditorPrivateKey: Hex;
  /// Defaults to `invoice-<index>` — purely a label for `RegisterResult`, not used for anything
  /// on-chain.
  label?: string;
}

export interface ResidualParams {
  /// Present => get a live Swap Kit quote (USDC -> EURC) for the total dangling amount. Never
  /// executes a real swap — matches spec's "estimateSwap is quote-only in the UI" claims
  /// discipline; a caller that wants a real fill does so separately, explicitly.
  swapKit?: ContraflowSwapKit;
  /// Present => actually fund the dangling amount onto Arc via Gateway. Requires `sourceChain`.
  fundVia?: ContraflowAppKitAdapter;
  sourceChain?: UnifiedBalanceChain;
  /// Passed straight through to `fundResidualViaGateway` — see its own defaults.
  pollIntervalMs?: number;
  maxPolls?: number;
}

export interface SettlementPipelineResult {
  registered: RegisterResult[];
  /// `null` when no cycle exists among the registered invoices at all (not an error — a valid
  /// outcome; see `NoSettleableCycleError`).
  settle: SettleResult | null;
  /// Registered invoices no settled cycle reached. Equals every registered id when `settle` is
  /// `null`.
  danglingInvoiceIds: readonly Hex[];
  residualQuote?: SwapEstimate;
  residualFund?: Awaited<ReturnType<typeof fundResidualViaGateway>>;
  /// Set instead of throwing when funding the residual fails after its deposit already landed —
  /// call `resumeFundResidualViaGateway` with this error's own fields to retry without
  /// re-depositing.
  residualFundError?: GatewayFundResidualPartialFailureError;
  /// `null` when `settle` is `null` — no settle result to compute tiles from.
  dashboardTiles: DashboardTiles | null;
}

/// USDC's own decimal count (6) — a known, spec-locked constant already used throughout this
/// app layer's `amountUsdc` string params (`unifiedBalance.ts`, `swap.ts`), not something to
/// query dynamically for this one stablecoin.
const USDC_DECIMALS = 6;

function formatUsdcAmount(baseUnits: bigint): string {
  return (Number(baseUnits) / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS);
}

export async function runSettlementPipeline(params: {
  publicClient: PublicClient;
  registerSigner: OperatorSigner;
  settleSigner: OperatorSigner;
  registry: Address;
  settler: Address;
  arcChainId: number;
  invoicesToRegister: PendingInvoice[];
  complianceProvider?: ComplianceProvider;
  residual?: ResidualParams;
}): Promise<SettlementPipelineResult> {
  const { publicClient, registerSigner, settleSigner, registry, settler, arcChainId, invoicesToRegister, complianceProvider, residual } = params;

  // Sequential, not Promise.all -- mirrors registerFixtureInvoices's own reasoning: a later
  // invoice's nonce derivation could depend on an earlier one this same call just confirmed if
  // they share a (debtor, creditor) pair.
  const registered: RegisterResult[] = [];
  for (let i = 0; i < invoicesToRegister.length; i++) {
    const pending = invoicesToRegister[i]!;
    const { debtorSignature, creditorSignature } = await signAttestation(pending.invoice, pending.debtorPrivateKey, pending.creditorPrivateKey);
    const result = await registerInvoice({
      publicClient,
      signer: registerSigner,
      registry,
      invoice: pending.invoice,
      debtorSignature,
      creditorSignature,
      complianceProvider,
    });
    registered.push({ label: pending.label ?? `invoice-${i}`, ...result });
  }

  const registeredIds = registered.map((r) => r.invoiceId);

  let settle: SettleResult | null;
  try {
    settle = await settleBestCycle({ publicClient, signer: settleSigner, registry, settler, invoiceIds: registeredIds });
  } catch (err) {
    if (err instanceof NoSettleableCycleError) {
      settle = null;
    } else {
      throw err; // a genuine settle() failure (not "no cycle") should surface, not be swallowed
    }
  }

  const settledIds = new Set(settle?.invoiceIds ?? []);
  const danglingInvoiceIds = registeredIds.filter((id) => !settledIds.has(id));
  const danglingAmountBaseUnits = invoicesToRegister
    .filter((p, i) => danglingInvoiceIds.includes(registered[i]!.invoiceId))
    .reduce((sum, p) => sum + p.invoice.amount, 0n);

  let residualQuote: SwapEstimate | undefined;
  let residualFund: SettlementPipelineResult["residualFund"];
  let residualFundError: GatewayFundResidualPartialFailureError | undefined;

  if (residual && danglingInvoiceIds.length > 0 && danglingAmountBaseUnits > 0n) {
    const amountUsdc = formatUsdcAmount(danglingAmountBaseUnits);

    if (residual.swapKit) {
      residualQuote = await estimateUsdcToEurcSwap({ swapKit: residual.swapKit, amountInUsdc: amountUsdc });
    }

    if (residual.fundVia) {
      if (!residual.sourceChain) throw new Error("runSettlementPipeline: residual.sourceChain is required when residual.fundVia is given");
      try {
        residualFund = await fundResidualViaGateway({
          appKit: residual.fundVia,
          arcChainId,
          sourceChain: residual.sourceChain,
          amountUsdc,
          pollIntervalMs: residual.pollIntervalMs,
          maxPolls: residual.maxPolls,
        });
      } catch (err) {
        if (err instanceof GatewayFundResidualPartialFailureError) {
          residualFundError = err;
        } else {
          throw err;
        }
      }
    }
  }

  return {
    registered,
    settle,
    danglingInvoiceIds,
    residualQuote,
    residualFund,
    residualFundError,
    dashboardTiles: settle ? computeDashboardTiles(settle) : null,
  };
}
