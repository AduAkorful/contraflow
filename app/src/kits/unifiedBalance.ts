/// Thin, typed wrappers over Circle App Kit's Unified Balance kit (Gateway `deposit`/`spend`),
/// scoped to Contraflow's one residual scenario: fund a leftover invoice on Arc from a balance
/// held on another chain. Same bounded-context rule as `swap.ts` — never imported by
/// `ContraflowSettler` or any Solidity code.

import type { AppKit } from "@circle-fin/app-kit";
import { UnifiedBalanceChain } from "@circle-fin/app-kit";
import type {
  DepositResult,
  EstimateSpendResult,
  GetBalancesResult,
  SpendResult,
} from "@circle-fin/app-kit";

import type { ContraflowAppKitAdapter } from "./appkit";

/// `estimateDeposit`'s result type isn't part of the package's public export surface (only the
/// method signature is) — derived structurally via `ReturnType` rather than guessing a name.
type EstimateDepositResult = Awaited<ReturnType<AppKit["unifiedBalance"]["estimateDeposit"]>>;
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { confirmedOn, fromBaseUnits, toBaseUnits } from "./gatewayBalance";
import { networkTypeForChainId } from "./gatewayChains";

const TOKEN = "USDC";

export class UnsupportedUnifiedBalanceChainError extends Error {
  constructor(chainId: number) {
    super(`Unified Balance has no UnifiedBalanceChain enum mapping for chain id ${chainId}`);
    this.name = "UnsupportedUnifiedBalanceChainError";
  }
}

/// Resolves the real `@circle-fin/app-kit` `UnifiedBalanceChain` enum value for a Contraflow
/// chain id — a distinct nominal type from `SwapChain`/`Blockchain` despite identical string
/// values.
export function unifiedBalanceChainForChainId(chainId: number): UnifiedBalanceChain {
  if (chainId === ARC_MAINNET_CHAIN_ID) return UnifiedBalanceChain.Arc;
  if (chainId === ARC_TESTNET_CHAIN_ID) return UnifiedBalanceChain.Arc_Testnet;
  throw new UnsupportedUnifiedBalanceChainError(chainId);
}

// `getBalances`'s `networkType` defaults to `'mainnet'` when omitted, silently querying the wrong
// network on testnet, so every call derives it from the Arc chain id via `networkTypeForChainId`.

/// Builds the `{ adapter, chain, address? }` context App Kit expects for a `from`/`to` field,
/// including `address` only when the adapter carries one — required for a Circle-wallet-backed
/// (developer-controlled) adapter, forbidden for the raw-private-key (user-controlled) one. Same
/// rule as `swap.ts`'s `buildSwapParams`, shared here since every call site below needs it. Two
/// distinct return shapes (with/without `address`), not one shape with an optional field — a
/// single always-chain-required union confused `tsc` into keeping `getUsdcBalances`'s no-chain
/// case in scope for these call sites too, so that one gets its own `adapterSources` below.
function adapterContext(appKit: ContraflowAppKitAdapter, chain: UnifiedBalanceChain) {
  return appKit.address
    ? { adapter: appKit.adapter, chain, address: appKit.address }
    : { adapter: appKit.adapter, chain };
}

/// Same as `adapterContext`, for `getBalances`'s `sources` field, which takes no `chain`.
function adapterSources(appKit: ContraflowAppKitAdapter) {
  return appKit.address ? { adapter: appKit.adapter, address: appKit.address } : { adapter: appKit.adapter };
}

export interface GetUsdcBalancesParams {
  appKit: ContraflowAppKitAdapter;
  /// Which network to query — see the `networkType` footgun noted above.
  arcChainId: number;
}

export function getUsdcBalances(params: GetUsdcBalancesParams): Promise<GetBalancesResult> {
  return params.appKit.kit.unifiedBalance.getBalances({
    token: TOKEN,
    sources: adapterSources(params.appKit),
    networkType: networkTypeForChainId(params.arcChainId),
  });
}

export interface DepositToGatewayParams {
  appKit: ContraflowAppKitAdapter;
  /// The chain the operator is depositing *from* (not Arc — Arc is always the spend destination
  /// in Contraflow's residual scenario). Taken as the SDK's own `UnifiedBalanceChain` enum value
  /// directly, not resolved from a numeric chain id: unlike Arc, this repo has no existing
  /// registry mapping arbitrary source-chain ids (Ethereum, Base, ...) to their enum values, and
  /// inventing one here risks a wrong/hand-typed mapping for a chain nothing else in the repo
  /// tracks. The caller (which knows which chain it's depositing from) supplies the enum.
  sourceChain: UnifiedBalanceChain;
  /// Human-readable decimal string, e.g. "100" for 100 USDC. Not base units.
  amountUsdc: string;
}

export function estimateDepositToGateway(params: DepositToGatewayParams): Promise<EstimateDepositResult> {
  return params.appKit.kit.unifiedBalance.estimateDeposit({
    from: adapterContext(params.appKit, params.sourceChain),
    amount: params.amountUsdc,
    token: TOKEN,
  });
}

export function depositToGateway(params: DepositToGatewayParams): Promise<DepositResult> {
  return params.appKit.kit.unifiedBalance.deposit({
    from: adapterContext(params.appKit, params.sourceChain),
    amount: params.amountUsdc,
    token: TOKEN,
  });
}

export interface SpendOntoArcParams {
  appKit: ContraflowAppKitAdapter;
  arcChainId: number;
  /// Which deposited chain to pull the Gateway balance from. `SpendSource`'s own doc comment
  /// says `allocations` can be omitted and auto-resolved from the top-level `amount` — that
  /// claim did not hold at runtime (crashed with "No chain definition found for blockchain:
  /// undefined" during a live proof run, 2026-09-19), so this wrapper always passes an explicit
  /// allocation instead of relying on the undocumented auto-resolution path.
  sourceChain: UnifiedBalanceChain;
  /// Human-readable decimal string. Not base units.
  amountUsdc: string;
  /// Retry data from a resumable SDK mint failure. This bypasses burn-intent signing and transfer.
  retryMint?: GatewayMintRetry;
}

function destinationChain(params: SpendOntoArcParams): UnifiedBalanceChain {
  return unifiedBalanceChainForChainId(params.arcChainId);
}

/// `SpendSource` is also `AdapterContext`-shaped (it extends the same `AddressField`
/// conditional type as `from`/`to` elsewhere), so it needs the same conditional `address` — plus
/// its own `allocations`, which `adapterContext` doesn't carry.
function spendSource(params: SpendOntoArcParams) {
  const allocations = [{ amount: params.amountUsdc, chain: params.sourceChain }];
  return params.appKit.address
    ? { adapter: params.appKit.adapter, allocations, address: params.appKit.address }
    : { adapter: params.appKit.adapter, allocations };
}

export function estimateSpendOntoArc(params: SpendOntoArcParams): Promise<EstimateSpendResult> {
  return params.appKit.kit.unifiedBalance.estimateSpend({
    from: spendSource(params),
    to: adapterContext(params.appKit, destinationChain(params)),
    token: TOKEN,
    amount: params.amountUsdc,
  });
}

export function spendOntoArc(params: SpendOntoArcParams): Promise<SpendResult> {
  const config = params.retryMint ? { config: { retry: params.retryMint } } : {};
  return params.appKit.kit.unifiedBalance.spend({
    from: spendSource(params),
    to: adapterContext(params.appKit, destinationChain(params)),
    token: TOKEN,
    amount: params.amountUsdc,
    ...config,
  });
}

export class GatewayDepositTimeoutError extends Error {
  constructor(
    public readonly sourceChain: UnifiedBalanceChain,
    public readonly targetConfirmedUsdc: string,
    public readonly lastConfirmedUsdc: string,
  ) {
    super(
      `Deposit on ${sourceChain} did not reach ${targetConfirmedUsdc} USDC confirmed in time ` +
        `(last seen: ${lastConfirmedUsdc})`,
    );
    this.name = "GatewayDepositTimeoutError";
  }
}

/// Thrown by `fundResidualViaGateway`/`resumeFundResidualViaGateway` for any failure that happens
/// **after** a deposit has already landed on-chain (a poll-loop timeout, or a transient error
/// from `getUsdcBalances`/`spendOntoArc` — both real, independent failure modes seen against
/// Circle's Gateway API). Calling `fundResidualViaGateway` again at
/// this point would deposit a **second** time, compounding the ~1.1 USDC fee for nothing. Carries
/// everything `resumeFundResidualViaGateway` needs to pick up from the poll step, skipping a
/// redundant deposit — deliberately not auto-recoverable from the current balance alone (a stale
/// pre-existing confirmed balance already once caused a similar absolute-threshold bug, see
/// `fundResidualViaGateway`'s own before/target design below).
export class GatewayFundResidualPartialFailureError extends Error {
  constructor(
    public readonly sourceChain: UnifiedBalanceChain,
    public readonly arcChainId: number,
    public readonly amountUsdc: string,
    public readonly depositAmountUsdc: string,
    /// The exact confirmed-balance threshold the original call was waiting for — pass this back
    /// into `resumeFundResidualViaGateway` verbatim, not recomputed, since recomputing it from a
    /// fresh "current balance" read would double-count the deposit that already happened.
    /// Human-readable USDC target, serialized as a decimal string for safe resume storage.
    public readonly target: string,
    public readonly recovery: "await_balance" | "retry_mint" | "manual_review",
    public readonly retryMint: GatewayMintRetry | null,
    public readonly cause: unknown,
    public readonly depositTxHash: string | null = null,
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `fundResidualViaGateway on ${sourceChain} could not complete safely: ${causeMessage}. ` +
        (recovery === "manual_review"
          ? "Do not start another spend; inspect the original transfer before taking action."
          : "Call resumeFundResidualViaGateway with this error's fields; it will not submit another deposit."),
    );
    this.name = "GatewayFundResidualPartialFailureError";
  }
}

export interface GatewayMintRetry {
  attestation: string;
  signature: string;
}

class GatewaySpendOutcomeError extends Error {
  readonly retryMint: GatewayMintRetry | null;
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "GatewaySpendOutcomeError";
    this.retryMint = gatewayMintRetryFrom(cause);
  }
}

function gatewayMintRetryFrom(error: unknown): GatewayMintRetry | null {
  if (!error || typeof error !== "object") return null;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return null;
  const trace = (cause as { trace?: unknown }).trace;
  if (!trace || typeof trace !== "object") return null;
  const { attestation, signature } = trace as Record<string, unknown>;
  if (typeof attestation !== "string" || !/^0x[0-9a-f]+$/i.test(attestation)) return null;
  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) return null;
  return { attestation, signature };
}

function gatewayTxHashFrom(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return null;
  const trace = (cause as { trace?: unknown }).trace;
  if (!trace || typeof trace !== "object") return null;
  const hash = (trace as Record<string, unknown>).txHash ?? (trace as Record<string, unknown>).transactionHash;
  return typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash) ? hash : null;
}

function confirmedBalanceForChain(result: GetBalancesResult, chain: UnifiedBalanceChain): bigint {
  return confirmedOn(result, String(chain));
}

/// Human-readable SDK amounts are converted to integer USDC base units before arithmetic.
function addUsdcAmounts(a: string, b: string): string {
  return fromBaseUnits(toBaseUnits(a) + toBaseUnits(b));
}

/// Fixed cross-chain fee overhead observed live on Ethereum Sepolia -> Arc testnet, 2026-09-19
/// (both the raw-key and DCW-adapter proofs): ~1.0999-1.1 USDC, roughly amount-independent. A
/// generous margin, not a precise fee model — `estimateSpendOntoArc` is the source of truth for
/// an actual fee if this default ever needs tightening.
const DEFAULT_GATEWAY_FEE_MARGIN_USDC = "1.20";

export interface FundResidualViaGatewayParams {
  appKit: ContraflowAppKitAdapter;
  arcChainId: number;
  sourceChain: UnifiedBalanceChain;
  /// The residual amount to actually land on Arc. The deposit itself is larger (see
  /// `depositAmountUsdc`) to cover Gateway's fee, which is subtracted from the deposited balance,
  /// not from `amountUsdc` — the recipient gets exactly `amountUsdc`, not `amountUsdc` minus fees.
  amountUsdc: string;
  /// Defaults to `amountUsdc + DEFAULT_GATEWAY_FEE_MARGIN_USDC`. Override once a real fee model
  /// (via `estimateSpendOntoArc`) is wired in, to avoid over-depositing.
  depositAmountUsdc?: string;
  pollIntervalMs?: number;
  maxPolls?: number;
}

/// The poll-then-spend half of `fundResidualViaGateway`, shared with `resumeFundResidualViaGateway`.
/// Takes `target` explicitly rather than deriving it from
/// a fresh "current balance" read, so a resumed call waits for the exact same threshold the
/// original deposit was meant to reach — not a value re-derived after the deposit has already
/// partly or fully confirmed, which would double-count it.
async function pollForConfirmedBalanceThenSpend(params: {
  appKit: ContraflowAppKitAdapter;
  arcChainId: number;
  sourceChain: UnifiedBalanceChain;
  amountUsdc: string;
  target: string;
  pollIntervalMs: number;
  maxPolls: number;
}): Promise<SpendResult> {
  const { appKit, arcChainId, sourceChain, amountUsdc, target, pollIntervalMs, maxPolls } = params;

  const targetBaseUnits = toBaseUnits(target);
  let lastConfirmed = 0n;
  for (let i = 0; i < maxPolls; i++) {
    lastConfirmed = confirmedBalanceForChain(await getUsdcBalances({ appKit, arcChainId }), sourceChain);
    if (lastConfirmed >= targetBaseUnits) {
      try {
        return await spendOntoArc({ appKit, arcChainId, sourceChain, amountUsdc });
      } catch (cause) {
        throw new GatewaySpendOutcomeError(cause);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new GatewayDepositTimeoutError(sourceChain, target, fromBaseUnits(lastConfirmed));
}

/// Automates the deposit -> wait for CCTP attestation -> spend sequence. Polls the *increase* in
/// confirmed balance on `sourceChain` relative to before this call's own deposit, not an
/// absolute threshold — correct regardless of whatever balance was already sitting there from
/// earlier activity, unlike a hardcoded absolute threshold.
///
/// Any failure once the deposit itself has landed (a poll timeout, or a transient error from the
/// underlying service) is wrapped in `GatewayFundResidualPartialFailureError` rather than left as
/// a raw/timeout error: calling this function again at that point would deposit a second time,
/// so the caller needs a clear signal to call `resumeFundResidualViaGateway` instead.
export async function fundResidualViaGateway(params: FundResidualViaGatewayParams): Promise<SpendResult> {
  const {
    appKit,
    arcChainId,
    sourceChain,
    amountUsdc,
    depositAmountUsdc = addUsdcAmounts(amountUsdc, DEFAULT_GATEWAY_FEE_MARGIN_USDC),
    pollIntervalMs = 30_000,
    maxPolls = 40,
  } = params;

  const before = confirmedBalanceForChain(await getUsdcBalances({ appKit, arcChainId }), sourceChain);
  const target = fromBaseUnits(before + toBaseUnits(depositAmountUsdc));

  let depositTxHash: string | null = null;
  try {
    const depositResult = await depositToGateway({ appKit, sourceChain, amountUsdc: depositAmountUsdc });
    depositTxHash = depositResult.txHash;
  } catch (cause) {
    // The SDK can fail after the wallet has broadcast. Preserve the original before/target and
    // wait for that deposit; never make a second deposit to recover an ambiguous first call.
    throw new GatewayFundResidualPartialFailureError(
      sourceChain, arcChainId, amountUsdc, depositAmountUsdc, target, "await_balance", null, cause, gatewayTxHashFrom(cause),
    );
  }

  try {
    return await pollForConfirmedBalanceThenSpend({ appKit, arcChainId, sourceChain, amountUsdc, target, pollIntervalMs, maxPolls });
  } catch (cause) {
    const spendFailure = cause instanceof GatewaySpendOutcomeError ? cause : null;
    const retryMint = spendFailure?.retryMint ?? null;
    const recovery = spendFailure ? (retryMint ? "retry_mint" : "manual_review") : "await_balance";
    throw new GatewayFundResidualPartialFailureError(sourceChain, arcChainId, amountUsdc, depositAmountUsdc, target, recovery, retryMint, cause, depositTxHash);
  }
}

/// Resumes a `fundResidualViaGateway` call that failed with `GatewayFundResidualPartialFailureError`
/// — the deposit already landed, so this picks up at the polling step directly, never depositing
/// again. Pass the failed error's own fields back verbatim (`target`/`depositAmountUsdc` included)
/// rather than reconstructing them, per the error class's own doc comment.
export async function resumeFundResidualViaGateway(params: {
  appKit: ContraflowAppKitAdapter;
  arcChainId: number;
  sourceChain: UnifiedBalanceChain;
  amountUsdc: string;
  depositAmountUsdc: string;
  target: string;
  recovery?: "await_balance" | "retry_mint" | "manual_review";
  retryMint?: GatewayMintRetry | null;
  depositTxHash?: string | null;
  pollIntervalMs?: number;
  maxPolls?: number;
}): Promise<SpendResult> {
  const { appKit, arcChainId, sourceChain, amountUsdc, depositAmountUsdc, target, pollIntervalMs = 30_000, maxPolls = 40 } = params;
  const { depositTxHash = null } = params;

  if (params.retryMint) {
    try {
      return await spendOntoArc({ appKit, arcChainId, sourceChain, amountUsdc, retryMint: params.retryMint });
    } catch (cause) {
      const retryMint = gatewayMintRetryFrom(cause) ?? params.retryMint;
      throw new GatewayFundResidualPartialFailureError(
        sourceChain, arcChainId, amountUsdc, depositAmountUsdc, target, "retry_mint", retryMint, cause, depositTxHash,
      );
    }
  }
  if (params.recovery !== "await_balance" && !params.retryMint) {
    throw new Error("Gateway spend outcome is ambiguous. Do not submit another spend; inspect the original transfer first.");
  }

  try {
    return await pollForConfirmedBalanceThenSpend({ appKit, arcChainId, sourceChain, amountUsdc, target, pollIntervalMs, maxPolls });
  } catch (cause) {
    const spendFailure = cause instanceof GatewaySpendOutcomeError ? cause : null;
    const retryMint = spendFailure?.retryMint ?? null;
    const recovery = spendFailure ? (retryMint ? "retry_mint" : "manual_review") : "await_balance";
    throw new GatewayFundResidualPartialFailureError(sourceChain, arcChainId, amountUsdc, depositAmountUsdc, target, recovery, retryMint, cause, depositTxHash);
  }
}
