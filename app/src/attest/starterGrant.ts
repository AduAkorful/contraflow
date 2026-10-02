/// One-time starter gas grant: a plain native-currency transfer from the operator wallet, gated
/// by a verified session (never a client-supplied address), one-time-per-address (DB), a rate
/// limit, a rolling daily spend cap, and an operator-balance-floor check (log/alert only, no
/// auto top-up). Every guardrail fails closed — rejected with a specific reason before any value
/// moves.

import type { Address } from "viem";
import { parseUnits } from "viem";
import { operatorSigner, arcPublicClient } from "../chain/operatorEnv";
import {
  completeStarterGrant,
  getStarterGrantOperation,
  hasReceivedStarterGrant,
  markStarterGrantReverted,
  markStarterGrantSubmitted,
  markStarterGrantUnknown,
  releaseUnsubmittedStarterGrant,
  reserveStarterGrantOperation,
} from "../db/addresses";
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
  | { ok: true; alreadyGranted: true; txHash?: string }
  | { ok: true; alreadyGranted: false; txHash: string }
  | { ok: false; reason: string };

export async function requestStarterGrant(address: Address): Promise<StarterGrantResult> {
  if (await hasReceivedStarterGrant(address)) {
    return { ok: true, alreadyGranted: true };
  }

  const client = arcPublicClient();
  const priorOperation = await getStarterGrantOperation(address);
  if (priorOperation) {
    const operation = priorOperation;
    if (operation.status === "confirmed") return { ok: true, alreadyGranted: true };
    if ((operation.status === "submitted" || operation.status === "unknown") && operation.txHash) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: operation.txHash as `0x${string}` });
        if (receipt.status === "success") {
          await completeStarterGrant(address, operation.txHash);
          return { ok: true, alreadyGranted: true, txHash: operation.txHash };
        }
        await markStarterGrantReverted(address);
        return { ok: false, reason: `The prior starter grant reverted (tx ${operation.txHash}); contact support before retrying.` };
      } catch {
        return { ok: false, reason: `A starter grant is already pending (tx ${operation.txHash}). Check Arc before retrying.` };
      }
    }
    return { ok: false, reason: "A starter grant request is already reserved but has no recorded transaction hash. It needs manual review; do not retry." };
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
  const reservation = await reserveStarterGrantOperation(address);
  if (!reservation.reserved) {
    // Another request won after the initial read. It may now be broadcasting; never race it with
    // a second transfer. The next authenticated retry will reconcile a recorded transaction hash.
    return { ok: false, reason: "A starter grant request just started for this address. Check again shortly; do not retry the transfer." };
  }
  let txHash: `0x${string}`;
  try {
    txHash = await signer.walletClient.sendTransaction({
      account: signer.walletClient.account!,
      chain: signer.walletClient.chain,
      to: address,
      value: valueWei,
    });
  } catch (error) {
    // A rejected RPC response can follow a broadcast. Keep the reservation as unknown; only an
    // operator can clear a row with no transaction hash after investigating the sender nonce.
    try { await markStarterGrantUnknown(address); } catch { /* reservation itself remains */ }
    throw error;
  }

  try {
    await markStarterGrantSubmitted(address, txHash);
  } catch (error) {
    try { await markStarterGrantUnknown(address, txHash); } catch { /* preserve the reservation */ }
    return { ok: false, reason: `The grant was submitted as ${txHash}, but its recovery record could not be updated. Check Arc before retrying.` };
  }

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, reason: `The grant is submitted as ${txHash} and its status is unknown. Check Arc before retrying.` };
  }
  if (receipt.status !== "success") {
    await markStarterGrantReverted(address);
    return { ok: false, reason: `Starter grant transfer reverted (tx ${txHash}).` };
  }

  await completeStarterGrant(address, txHash);
  return { ok: true, alreadyGranted: false, txHash };
}

// Exported so callers that only need to know the configured amount (e.g. UI copy) don't have
// to reach into `process.env` themselves.
export { grantAmountUsdc };
