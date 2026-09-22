/// One-time starter gas grant: a plain native-currency transfer from the operator wallet, gated
/// by a verified session (never a client-supplied address), one-time-per-address (DB), a rate
/// limit, a rolling daily spend cap, and an operator-balance-floor check (log/alert only, no
/// auto top-up). Every guardrail fails closed — rejected with a specific reason before any value
/// moves.

import type { Address } from "viem";
import { parseUnits } from "viem";
import { operatorSigner, arcPublicClient } from "../chain/operatorEnv";
import { hasReceivedStarterGrant, recordStarterGrant } from "../db/addresses";
import { checkRateLimit, incrementWindowCounter } from "../ratelimit/limiter";

const GRANT_RATE_LIMIT_MAX = 3;
const GRANT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DAILY_SPEND_CAP_USDC = 1;
/// Alert-only threshold, native USDC (18 decimals) — log/alert, not a hard block; an
/// actually-insufficient balance still fails naturally at the transfer step below.
const OPERATOR_BALANCE_FLOOR_USDC = "1";

function grantAmountUsdc(): string {
  return process.env.STARTER_GAS_GRANT_AMOUNT_USDC ?? "0.05";
}

export type StarterGrantResult =
  | { ok: true; alreadyGranted: true }
  | { ok: true; alreadyGranted: false; txHash: string }
  | { ok: false; reason: string };

export async function requestStarterGrant(address: Address): Promise<StarterGrantResult> {
  if (await hasReceivedStarterGrant(address)) {
    return { ok: true, alreadyGranted: true };
  }

  // Address-keyed, not IP-keyed — deliberate simplification given design decision 2 (session-gated
  // callers only reach this function at all): spamming many distinct addresses already costs a
  // valid SIWE signature per address, a real per-address rate limit is what actually matters here.
  const rateLimit = await checkRateLimit(`starter-grant:${address}`, GRANT_RATE_LIMIT_MAX, GRANT_RATE_LIMIT_WINDOW_SECONDS);
  if (!rateLimit.allowed) {
    return { ok: false, reason: "Too many grant requests for this address — try again shortly." };
  }

  // Incremented before the transfer, not after — a failed transfer still counts against the day's
  // budget. Deliberate: undercounting available capacity on a failure is the safe direction (the
  // cap exists to bound the operator's worst-case daily payout, not to guarantee every legitimate
  // request succeeds), and the alternative — decrementing on failure — reopens a race where two
  // concurrent requests could both "reclaim" the same slot.
  const today = new Date().toISOString().slice(0, 10);
  const grantsToday = await incrementWindowCounter(`starter-grant-count:${today}`, 24 * 60 * 60);
  const amount = Number(grantAmountUsdc());
  if (grantsToday * amount > DAILY_SPEND_CAP_USDC) {
    return { ok: false, reason: "Daily starter-grant budget reached — try again tomorrow." };
  }

  const client = arcPublicClient();
  const signer = operatorSigner();
  // A plain native-currency transfer needs a real wallet client directly, not the DCW
  // contract-execution path — `operatorSigner()` only ever constructs `raw-key` today, but this
  // stays an explicit runtime check rather than a cast, matching this project's "verify, don't
  // assume" discipline for anything that crosses a real signer boundary.
  if (signer.kind !== "raw-key") {
    throw new Error("requestStarterGrant: starter grants require a raw-key operator signer");
  }
  const operatorAddress = signer.walletClient.account?.address;
  if (!operatorAddress) throw new Error("requestStarterGrant: operator signer has no account attached");

  const balance = await client.getBalance({ address: operatorAddress });
  const floorWei = parseUnits(OPERATOR_BALANCE_FLOOR_USDC, 18);
  if (balance < floorWei) {
    console.error(
      `ALERT: operator wallet ${operatorAddress} balance (${balance} wei) is under the starter-grant floor (${floorWei} wei). No auto top-up — fund it manually.`,
    );
  }

  const valueWei = parseUnits(grantAmountUsdc(), 18);
  const txHash = await signer.walletClient.sendTransaction({
    account: signer.walletClient.account!,
    chain: signer.walletClient.chain,
    to: address,
    value: valueWei,
  });

  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    return { ok: false, reason: `Starter grant transfer reverted (tx ${txHash}).` };
  }

  await recordStarterGrant(address, txHash);
  return { ok: true, alreadyGranted: false, txHash };
}

// Exported so callers that only need to know the configured amount (e.g. UI copy) don't have
// to reach into `process.env` themselves.
export { grantAmountUsdc };
