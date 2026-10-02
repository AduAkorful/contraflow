/// Atomic worst-case gas reservations for public demo actions. Amounts are native USDC
/// (18-decimal wei) at the transaction's hard gas and fee caps, rounded up to ERC-20-style
/// micro-USDC for the daily ledger. Reservations are intentionally not refunded: after a
/// submission ambiguity, releasing one could let a retry exceed the operator's hard ceiling.

import { createHash } from "node:crypto";
import { redis } from "../upstash/client";

const DAILY_BUDGET_MICRO_USDC = 2_000_000;
const REQUESTS_PER_IP_PER_MINUTE = 30;
const BUDGET_TTL_SECONDS = 172_800;
const MICRO_USDC_IN_WEI = 10n ** 12n;

export const DEMO_MAX_FEE_PER_GAS = 200_000_000_000n;
export const DEMO_REGISTER_MAX_GAS = 250_000n;
export const DEMO_SETTLE_MAX_GAS = 500_000n;

export interface DemoTransactionLimits {
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export const DEMO_REGISTER_TRANSACTION_LIMITS: DemoTransactionLimits = {
  gas: DEMO_REGISTER_MAX_GAS,
  maxFeePerGas: DEMO_MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: DEMO_MAX_FEE_PER_GAS,
};

export const DEMO_SETTLE_TRANSACTION_LIMITS: DemoTransactionLimits = {
  gas: DEMO_SETTLE_MAX_GAS,
  maxFeePerGas: DEMO_MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: DEMO_MAX_FEE_PER_GAS,
};

function maxCostMicroUsdc(limits: DemoTransactionLimits): number {
  const wei = limits.gas * limits.maxFeePerGas;
  const micro = (wei + MICRO_USDC_IN_WEI - 1n) / MICRO_USDC_IN_WEI;
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Demo transaction cap is out of range");
  return Number(micro);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const CLAIM_SCRIPT = `
local prior = redis.call('GET', KEYS[1])
if prior then return cjson.encode({ status = 'existing', value = prior }) end

local count = redis.call('INCR', KEYS[2])
if count == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
if count > tonumber(ARGV[3]) then
  return cjson.encode({ status = 'rate_limited' })
end

local current = tonumber(redis.call('GET', KEYS[3]) or '0')
local cost = tonumber(ARGV[1])
if current + cost > tonumber(ARGV[2]) then
  return cjson.encode({ status = 'budget_exceeded' })
end

redis.call('INCRBY', KEYS[3], ARGV[1])
if current == 0 then redis.call('EXPIRE', KEYS[3], ARGV[5]) end
redis.call('SET', KEYS[1], 'pending')
return cjson.encode({ status = 'reserved' })
`;

export type DemoSpendClaim =
  | { kind: "reserved"; operationKey: string }
  | { kind: "complete"; result: unknown }
  | { kind: "pending" }
  | { kind: "rate_limited" }
  | { kind: "budget_exceeded" }
  | { kind: "unavailable" };

export type DemoSpendInspection =
  | { kind: "available" }
  | { kind: "complete"; result: unknown }
  | { kind: "pending" }
  | { kind: "unavailable" };

interface ClaimResponse {
  status: "reserved" | "existing" | "rate_limited" | "budget_exceeded";
  value?: unknown;
}

function parseClaimResponse(value: unknown): ClaimResponse | null {
  if (value && typeof value === "object") {
    const response = value as Partial<ClaimResponse>;
    if (["reserved", "existing", "rate_limited", "budget_exceeded"].includes(String(response.status))) {
      return response as ClaimResponse;
    }
  }
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const response = parsed as Partial<ClaimResponse>;
    if (["reserved", "existing", "rate_limited", "budget_exceeded"].includes(String(response.status))) {
      return response as ClaimResponse;
    }
    return null;
  } catch {
    return null;
  }
}

function resultFromStoredValue(value: unknown): DemoSpendInspection | null {
  if (value === null || value === undefined) return null;
  if (value === "pending") return { kind: "pending" };
  if (value && typeof value === "object" && (value as { status?: unknown }).status === "complete") {
    return { kind: "complete", result: (value as { result: unknown }).result };
  }
  if (typeof value !== "string") return { kind: "unavailable" };
  try {
    const completed: unknown = JSON.parse(value);
    if (completed && typeof completed === "object" && (completed as { status?: unknown }).status === "complete") {
      return { kind: "complete", result: (completed as { result: unknown }).result };
    }
  } catch {
    // A malformed/stale result remains unavailable. Never turn it into permission to rebroadcast.
  }
  return { kind: "unavailable" };
}

export async function inspectDemoSpend(operationId: string): Promise<DemoSpendInspection> {
  if (!operationId || operationId.length > 512) return { kind: "unavailable" };
  const operationKey = `demo:operation:${sha256(operationId)}`;
  try {
    const prior = await redis().get<string>(operationKey);
    return resultFromStoredValue(prior) ?? { kind: "available" };
  } catch {
    return { kind: "unavailable" };
  }
}

/// Atomically deduplicates an operation, limits its IP bucket and reserves its worst-case gas
/// cost. The idempotency key is permanent: a process dying after broadcast must not make the same
/// caller-supplied fixture salt eligible to broadcast again tomorrow.
export async function claimDemoSpend(params: {
  operationId: string;
  callerIp: string;
  limits: DemoTransactionLimits;
  now?: Date;
}): Promise<DemoSpendClaim> {
  if (!params.operationId || params.operationId.length > 512) return { kind: "unavailable" };

  const operationKey = `demo:operation:${sha256(params.operationId)}`;
  const windowStart = Math.floor(Date.now() / 60_000);
  const day = (params.now ?? new Date()).toISOString().slice(0, 10);
  const ipHash = sha256(params.callerIp || "unknown");
  const callerKey = `demo:ip:${ipHash}:${windowStart}`;
  const budgetKey = `demo:budget:${day}`;
  let raw: unknown;
  try {
    raw = await redis().eval(
      CLAIM_SCRIPT,
      [operationKey, callerKey, budgetKey],
      [
        String(maxCostMicroUsdc(params.limits)),
        String(DAILY_BUDGET_MICRO_USDC),
        String(REQUESTS_PER_IP_PER_MINUTE),
        "120",
        String(BUDGET_TTL_SECONDS),
      ],
    );
  } catch {
    return { kind: "unavailable" };
  }

  const response = parseClaimResponse(raw);
  if (!response) return { kind: "unavailable" };
  if (response.status === "reserved") return { kind: "reserved", operationKey };
  if (response.status === "rate_limited") return { kind: "rate_limited" };
  if (response.status === "budget_exceeded") return { kind: "budget_exceeded" };
  const prior = resultFromStoredValue(response.value);
  return !prior || prior.kind === "available" ? { kind: "unavailable" } : prior;
}

/// Stores the exact action result. If this write fails after a confirmed transaction, the
/// permanent `pending` tombstone still prevents a duplicate broadcast; the caller must report the
/// confirmed transaction hash and the retry must reconcile rather than submit again.
export async function completeDemoSpend(operationKey: string, result: unknown): Promise<void> {
  await redis().set(operationKey, JSON.stringify({ status: "complete", result }));
}

export function demoSpendCostMicroUsdc(limits: DemoTransactionLimits): number {
  return maxCostMicroUsdc(limits);
}

export const DEMO_DAILY_BUDGET_MICRO_USDC = DAILY_BUDGET_MICRO_USDC;
