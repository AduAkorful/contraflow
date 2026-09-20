/// Thin, typed wrappers over Circle App Kit's Swap Kit (`kit.estimateSwap` / `kit.swap`),
/// scoped to Contraflow's one residual scenario: USDC -> EURC (spec §4.2 FR-2.3, §4.3 FR-3.2).
/// Deliberately never imported by `ContraflowSettler` or any Solidity code — App Kit runs in
/// TypeScript against wallet adapters and does not share a revert boundary with the settler
/// (spec preamble, `00-architecture.md`'s `kits` bounded context). See `plans/06-swap-kit.md`.

import type { SwapEstimate, SwapParams, SwapResult } from "@circle-fin/app-kit";

import type { ContraflowSwapKit } from "./appkit";

const TOKEN_IN = "USDC";
const TOKEN_OUT = "EURC";

export interface UsdcToEurcSwapParams {
  swapKit: ContraflowSwapKit;
  /// Human-readable decimal string, e.g. "1.00" for 1 USDC. Not base units.
  amountInUsdc: string;
  /// Basis points; defaults to the SDK's own default (300 = 3%) when omitted.
  slippageBps?: number;
  /// Optional — Swap Kit does not require an API key (unlike Onramp), but Circle recommends one
  /// for production/high-volume usage to avoid rate limiting.
  apiKey?: string;
}

function buildSwapParams(params: UsdcToEurcSwapParams): SwapParams {
  const { swapKit, amountInUsdc, slippageBps, apiKey } = params;
  // `address` is only included when present — required for a Circle-wallet-backed adapter,
  // forbidden for the raw-private-key adapter (see `ContraflowAppKitAdapter`'s doc comment).
  const from = swapKit.address
    ? { adapter: swapKit.adapter, chain: swapKit.chain, address: swapKit.address }
    : { adapter: swapKit.adapter, chain: swapKit.chain };
  return {
    from,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: amountInUsdc,
    config: { slippageBps, apiKey },
  };
}

/// Quote-only — spec §9.1 screen #5 ("Quote — not a fill") and FR-2.3. No funds move, no gas
/// spent, no signature requested.
export function estimateUsdcToEurcSwap(params: UsdcToEurcSwapParams): Promise<SwapEstimate> {
  return params.swapKit.kit.estimateSwap(buildSwapParams(params));
}

/// Executes the swap for real (spec FR-3.2, Phase 2 — pulled forward per the 2026-09-18 phase-
/// sequencing decision). Moves the operator's USDC and returns a real `SwapResult`/`txHash`.
export function swapUsdcToEurc(params: UsdcToEurcSwapParams): Promise<SwapResult> {
  return params.swapKit.kit.swap(buildSwapParams(params));
}
