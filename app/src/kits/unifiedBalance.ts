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

/// `getBalances`'s `networkType` defaults to `'mainnet'` when omitted — silently querying the
/// wrong network on testnet. Derived from the same Arc chain id so no call site can forget it.
function networkTypeForChainId(chainId: number): "mainnet" | "testnet" {
  return chainId === ARC_MAINNET_CHAIN_ID ? "mainnet" : "testnet";
}

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
  return params.appKit.kit.unifiedBalance.spend({
    from: spendSource(params),
    to: adapterContext(params.appKit, destinationChain(params)),
    token: TOKEN,
    amount: params.amountUsdc,
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
    public readonly target: number,
    public readonly cause: unknown,
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `fundResidualViaGateway: deposit of ${depositAmountUsdc} USDC on ${sourceChain} already ` +
        `landed, but funding could not complete: ${causeMessage}. Call ` +
        `resumeFundResidualViaGateway with this error's fields to retry without re-depositing.`,
    );
    this.name = "GatewayFundResidualPartialFailureError";
  }
}

function confirmedBalanceForChain(result: GetBalancesResult, chain: UnifiedBalanceChain): number {
  // `breakdown[].chain` is typed `Blockchain`, not `UnifiedBalanceChain` — the same cross-SDK
  // enum mismatch already seen in request params (see `adapterContext`'s doc comment), this time
  // in a response type. Runtime values are the same strings; compare as strings, not enum types.
  const entry = result.breakdown[0]?.breakdown.find((b) => String(b.chain) === String(chain));
  return Number(entry?.confirmedBalance ?? "0");
}

/// USDC amounts here are human-readable decimal strings, not base units — this is arithmetic at
/// the App-Kit-call boundary (the SDK itself converts to base units internally), not token math,
/// so plain `Number` + `toFixed(6)` (USDC's own decimal count) is the right precision, not a case
/// for the `10 ** decimals()` scaling this repo's own rules require for actual on-chain amounts.
function addUsdcAmounts(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(6);
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
  target: number;
  pollIntervalMs: number;
  maxPolls: number;
}): Promise<SpendResult> {
  const { appKit, arcChainId, sourceChain, amountUsdc, target, pollIntervalMs, maxPolls } = params;

  let lastConfirmed = 0;
  for (let i = 0; i < maxPolls; i++) {
    lastConfirmed = confirmedBalanceForChain(await getUsdcBalances({ appKit, arcChainId }), sourceChain);
    if (lastConfirmed >= target) {
      return spendOntoArc({ appKit, arcChainId, sourceChain, amountUsdc });
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new GatewayDepositTimeoutError(sourceChain, target.toFixed(6), lastConfirmed.toFixed(6));
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
  const target = before + Number(depositAmountUsdc);

  await depositToGateway({ appKit, sourceChain, amountUsdc: depositAmountUsdc });

  try {
    return await pollForConfirmedBalanceThenSpend({ appKit, arcChainId, sourceChain, amountUsdc, target, pollIntervalMs, maxPolls });
  } catch (cause) {
    throw new GatewayFundResidualPartialFailureError(sourceChain, arcChainId, amountUsdc, depositAmountUsdc, target, cause);
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
  target: number;
  pollIntervalMs?: number;
  maxPolls?: number;
}): Promise<SpendResult> {
  const { appKit, arcChainId, sourceChain, amountUsdc, depositAmountUsdc, target, pollIntervalMs = 30_000, maxPolls = 40 } = params;

  try {
    return await pollForConfirmedBalanceThenSpend({ appKit, arcChainId, sourceChain, amountUsdc, target, pollIntervalMs, maxPolls });
  } catch (cause) {
    throw new GatewayFundResidualPartialFailureError(sourceChain, arcChainId, amountUsdc, depositAmountUsdc, target, cause);
  }
}
