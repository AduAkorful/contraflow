import type { GatewayMintRetry } from "./unifiedBalance";

export interface PendingGatewayMove {
  version: 1;
  operationId: string;
  owner: `0x${string}`;
  sourceChain: string;
  arcChainId: number;
  recipient: `0x${string}`;
  amountUsdc: string;
  state: "submission_unknown" | "retry_mint" | "mint_retry_submitting" | "forwarder_pending";
  transferId?: string;
  expirationBlock?: string;
  retryMint?: GatewayMintRetry;
  createdAt: number;
}

export interface PendingGatewayDeposit {
  version: 1;
  operationId: string;
  owner: `0x${string}`;
  sourceChain: string;
  amountUsdc: string;
  baselineConfirmedUsdc: string;
  state: "submission_unknown";
  txHash?: string;
  createdAt: number;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const keyFor = (owner: string) => `contraflow.gateway.move.v1:${owner.toLowerCase()}`;
const depositKeyFor = (owner: string) => `contraflow.gateway.deposit.v1:${owner.toLowerCase()}`;
const RECOVERY_EVENT = "contraflow:gateway-recovery";

function announceChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RECOVERY_EVENT));
}

function validMove(value: unknown): value is PendingGatewayMove {
  if (!value || typeof value !== "object") return false;
  const move = value as Record<string, unknown>;
  const retryMint = move.retryMint && typeof move.retryMint === "object" ? move.retryMint as Record<string, unknown> : null;
  const validRetry = retryMint && typeof retryMint.attestation === "string" && /^0x[0-9a-f]+$/i.test(retryMint.attestation) &&
    typeof retryMint.signature === "string" && /^0x[0-9a-f]+$/i.test(retryMint.signature);
  return move.version === 1 && typeof move.operationId === "string" &&
    typeof move.owner === "string" && /^0x[0-9a-f]{40}$/i.test(move.owner) &&
    typeof move.sourceChain === "string" && typeof move.arcChainId === "number" &&
    typeof move.recipient === "string" && /^0x[0-9a-f]{40}$/i.test(move.recipient) &&
    typeof move.amountUsdc === "string" && /^\d+(?:\.\d{1,6})?$/.test(move.amountUsdc) &&
    (move.state === "submission_unknown" || move.state === "retry_mint" || move.state === "mint_retry_submitting" || move.state === "forwarder_pending") &&
    typeof move.createdAt === "number" &&
    (move.retryMint === undefined || validRetry === true) &&
    (move.state !== "retry_mint" || validRetry === true) &&
    (move.state !== "forwarder_pending" || (typeof move.transferId === "string" && move.transferId.length > 0)) &&
    (move.expirationBlock === undefined || (typeof move.expirationBlock === "string" && /^\d+$/.test(move.expirationBlock)));
}

export function readPendingGatewayMove(storage: KeyValueStorage, owner: string): PendingGatewayMove | null {
  const raw = storage.getItem(keyFor(owner));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!validMove(parsed) || parsed.owner.toLowerCase() !== owner.toLowerCase()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingGatewayMove(storage: KeyValueStorage, move: PendingGatewayMove): void {
  if (!validMove(move)) throw new Error("Gateway recovery record is invalid.");
  storage.setItem(keyFor(move.owner), JSON.stringify(move));
  announceChange();
}

export function clearPendingGatewayMove(storage: KeyValueStorage, owner: string): void {
  storage.removeItem(keyFor(owner));
  announceChange();
}

export function readPendingGatewayDeposit(storage: KeyValueStorage, owner: string): PendingGatewayDeposit | null {
  const raw = storage.getItem(depositKeyFor(owner));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingGatewayDeposit>;
    if (parsed.version !== 1 || typeof parsed.operationId !== "string" ||
      typeof parsed.owner !== "string" || !/^0x[0-9a-f]{40}$/i.test(parsed.owner) || parsed.owner.toLowerCase() !== owner.toLowerCase() ||
      typeof parsed.sourceChain !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(parsed.amountUsdc ?? "") ||
      !/^\d+(?:\.\d{1,6})?$/.test(parsed.baselineConfirmedUsdc ?? "") || parsed.state !== "submission_unknown" ||
      (parsed.txHash !== undefined && (typeof parsed.txHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(parsed.txHash))) ||
      typeof parsed.createdAt !== "number") return null;
    return parsed as PendingGatewayDeposit;
  } catch {
    return null;
  }
}

export function savePendingGatewayDeposit(storage: KeyValueStorage, deposit: PendingGatewayDeposit): void {
  if (!/^0x[0-9a-f]{40}$/i.test(deposit.owner) ||
      !/^\d+(?:\.\d{1,6})?$/.test(deposit.amountUsdc) ||
      !/^\d+(?:\.\d{1,6})?$/.test(deposit.baselineConfirmedUsdc)) {
    throw new Error("Gateway deposit recovery record is invalid.");
  }
  storage.setItem(depositKeyFor(deposit.owner), JSON.stringify(deposit));
  announceChange();
}

export function clearPendingGatewayDeposit(storage: KeyValueStorage, owner: string): void {
  storage.removeItem(depositKeyFor(owner));
  announceChange();
}

export const GATEWAY_RECOVERY_EVENT = RECOVERY_EVENT;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function gatewayMoveRecoveryFromError(error: unknown): Pick<PendingGatewayMove, "state" | "transferId" | "retryMint"> {
  const top = object(error);
  const cause = object(top?.cause);
  const trace = object(cause?.trace) ?? object(top?.trace);
  const retryMint = typeof trace?.attestation === "string" && /^0x[0-9a-f]+$/i.test(trace.attestation) &&
    typeof trace?.signature === "string" && /^0x[0-9a-f]+$/i.test(trace.signature)
    ? { attestation: trace.attestation, signature: trace.signature }
    : undefined;
  const transferId = typeof trace?.transferId === "string" && trace.transferId.length > 0 ? trace.transferId : undefined;
  if (retryMint) return { state: "retry_mint", retryMint };
  if (transferId) return { state: "forwarder_pending", transferId };
  return { state: "submission_unknown" };
}

export function gatewayTxHashFromError(error: unknown): string | null {
  const top = object(error);
  const cause = object(top?.cause);
  const trace = object(cause?.trace) ?? object(top?.trace);
  const hash = trace?.txHash ?? trace?.transactionHash;
  return typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash) ? hash : null;
}
