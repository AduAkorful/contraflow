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
import { registerInvoice, RegisterTransactionOutcomeError, type RegisterResult } from "./register";
import { settleBestCycle, NoSettleableCycleError, SettleTransactionOutcomeError, type SettleResult } from "./settle";
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
  /// `null` unless this invocation confirmed a settlement.
  settle: SettleResult | null;
  settleStatus: "settled" | "no_cycle" | "failed" | "unknown" | "not_attempted";
  settleError?: { message: string; txHash?: Hex };
  registrationError?: { index: number; label: string; message: string; outcome: "failed" | "unknown"; txHash?: Hex };
  /// Registered invoices no settled cycle reached. Equals every registered id when `settle` is
  /// `null`.
  danglingInvoiceIds: readonly Hex[];
  residualQuote?: SwapEstimate;
  residualQuoteError?: string;
  residualFund?: Awaited<ReturnType<typeof fundResidualViaGateway>>;
  /// Set instead of throwing when funding the residual fails after its deposit already landed —
  /// call `resumeFundResidualViaGateway` with this error's own fields to retry without
  /// re-depositing.
  residualFundError?: GatewayFundResidualPartialFailureError;
  residualFundingError?: string;
  /// `null` when `settle` is `null` — no settle result to compute tiles from.
  dashboardTiles: DashboardTiles | null;
}

import { fromBaseUnits } from "../kits/gatewayBalance";

function formatUsdcAmount(baseUnits: bigint): string {
  return fromBaseUnits(baseUnits);
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
  let registrationError: SettlementPipelineResult["registrationError"];
  for (let i = 0; i < invoicesToRegister.length; i++) {
    const pending = invoicesToRegister[i]!;
    const { debtorSignature, creditorSignature } = await signAttestation(pending.invoice, pending.debtorPrivateKey, pending.creditorPrivateKey);
    const label = pending.label ?? `invoice-${i}`;
    try {
      const result = await registerInvoice({
        publicClient,
        signer: registerSigner,
        registry,
        invoice: pending.invoice,
        debtorSignature,
        creditorSignature,
        complianceProvider,
      });
      registered.push({ label, ...result });
    } catch (err) {
      const known = err instanceof RegisterTransactionOutcomeError ? err : null;
      registrationError = {
        index: i,
        label,
        message: err instanceof Error ? err.message : String(err),
        outcome: known?.outcome === "reverted" ? "failed" : "unknown",
        ...(known ? { txHash: known.txHash } : {}),
      };
      break;
    }
  }

  const registeredIds = registered.map((r) => r.invoiceId);

  let settle: SettleResult | null = null;
  let settleStatus: SettlementPipelineResult["settleStatus"] = registrationError ? "not_attempted" : "no_cycle";
  let settleError: SettlementPipelineResult["settleError"];
  if (!registrationError) {
    try {
      settle = await settleBestCycle({ publicClient, signer: settleSigner, registry, settler, invoiceIds: registeredIds, complianceProvider });
      settleStatus = "settled";
    } catch (err) {
      if (err instanceof NoSettleableCycleError) {
        settleStatus = "no_cycle";
      } else {
        const known = err instanceof SettleTransactionOutcomeError ? err : null;
        settleStatus = known?.outcome === "reverted" ? "failed" : "unknown";
        settleError = {
          message: err instanceof Error ? err.message : String(err),
          ...(known ? { txHash: known.txHash } : {}),
        };
      }
    }
  }

  const settledIds = new Set(settle?.invoiceIds ?? []);
  const danglingInvoiceIds = registeredIds.filter((id) => !settledIds.has(id));
  // Registration stops at the first failure, so only the successfully registered prefix can
  // contribute. Indexing from the input array would read past `registered` on an early failure.
  const danglingAmountBaseUnits = registered.reduce((sum, result, i) => {
    if (!danglingInvoiceIds.includes(result.invoiceId)) return sum;
    return sum + invoicesToRegister[i]!.invoice.amount;
  }, 0n);

  let residualQuote: SwapEstimate | undefined;
  let residualQuoteError: string | undefined;
  let residualFund: SettlementPipelineResult["residualFund"];
  let residualFundError: GatewayFundResidualPartialFailureError | undefined;
  let residualFundingError: string | undefined;

  if (residual && (settleStatus === "settled" || settleStatus === "no_cycle") && danglingInvoiceIds.length > 0 && danglingAmountBaseUnits > 0n) {
    const amountUsdc = formatUsdcAmount(danglingAmountBaseUnits);

    if (residual.swapKit) {
      try {
        residualQuote = await estimateUsdcToEurcSwap({ swapKit: residual.swapKit, amountInUsdc: amountUsdc });
      } catch (err) {
        residualQuoteError = err instanceof Error ? err.message : String(err);
      }
    }

    if (residual.fundVia) {
      try {
        if (!residual.sourceChain) throw new Error("runSettlementPipeline: residual.sourceChain is required when residual.fundVia is given");
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
          residualFundingError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }

  return {
    registered,
    settle,
    settleStatus,
    settleError,
    registrationError,
    danglingInvoiceIds,
    residualQuote,
    residualQuoteError,
    residualFund,
    residualFundError,
    residualFundingError,
    dashboardTiles: settle ? computeDashboardTiles(settle) : null,
  };
}
