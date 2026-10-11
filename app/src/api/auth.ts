/// Who is calling, and may they act for this party? Every API route starts here. Keys decide the
/// chain; permissions decide which parties a tenant can reach. A non-party and a party without a
/// live permission look the same to the caller: "Not found", as in the web app.

import type { Address, Hex } from "viem";
import { addressesForChain, APP_CHAIN_ID } from "../contracts/addresses";
import { chainIdForMode, hashApiKey, keyMode, type KeyMode } from "./keys";
import { hasScope, type ScopeName } from "./permissions";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /// Extra fields for the error body, such as the existing proposal on a duplicate.
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface ApiCaller {
  tenantId: Hex;
  mode: KeyMode;
  chainId: number;
}

export interface StoredKey {
  tenantId: Hex;
  mode: KeyMode;
  revoked: boolean;
  tenantActive: boolean;
}

export interface StoredPermission {
  permissionId: string;
  tenantId: Hex;
  chainId: number;
  party: Address;
  scopes: number;
  expiresAt: bigint;
  revoked: boolean;
}

export interface NewPermission extends Omit<StoredPermission, "revoked"> {
  nonce: Hex;
  signature: Hex;
}

export interface IdempotencyContext {
  key: string;
  requestHash: string;
  leaseToken: string;
}

export interface TenantInfo {
  name: string;
  status: "active" | "suspended";
  webhookConfigured: boolean;
}

export interface TenantStore {
  findKey(hash: string): Promise<StoredKey | null>;
  getTenant(tenantId: Hex): Promise<TenantInfo | null>;
  /// False when a permission with the same tenant, chain, party and nonce already exists.
  savePermission(permission: NewPermission, idempotency?: IdempotencyContext): Promise<boolean>;
  permissionsFor(tenantId: Hex, chainId: number, party: Address): Promise<StoredPermission[]>;
  listPermissions(tenantId: Hex, chainId: number, party?: Address): Promise<StoredPermission[]>;
  /// False when there's no such unrevoked permission for this tenant.
  revokePermission(tenantId: Hex, permissionId: string): Promise<boolean>;
}

const UNAUTHORIZED = new ApiError(401, "unauthorized", "Missing or invalid API key.");

function chainDeployed(chainId: number): boolean {
  try {
    addressesForChain(chainId);
    return true;
  } catch {
    return false;
  }
}

export async function authenticate(authorization: string | null, store: TenantStore): Promise<ApiCaller> {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!match) throw UNAUTHORIZED;
  const key = match[1]!;
  const mode = keyMode(key);
  if (!mode) throw UNAUTHORIZED;

  const stored = await store.findKey(hashApiKey(key));
  if (!stored || stored.revoked || !stored.tenantActive || stored.mode !== mode) throw UNAUTHORIZED;

  // The services under the API are bound to the chain this deployment serves, so a key for the
  // other chain can never be honoured here, whatever else is configured.
  const chainId = chainIdForMode(mode);
  if (chainId !== APP_CHAIN_ID) {
    throw mode === "live"
      ? new ApiError(403, "live_unavailable", "Live keys work on Contraflow's Arc mainnet deployment. This deployment serves the test network; use a test key.")
      : new ApiError(403, "test_unavailable", "Test keys aren't available on Arc mainnet. Sign in and create a live key at /app/api-keys.");
  }
  if (!chainDeployed(chainId)) {
    throw new ApiError(403, "live_unavailable", "Live keys work once Contraflow is on Arc mainnet.");
  }
  return { tenantId: stored.tenantId, mode, chainId };
}

/// Throws "Not found" unless the tenant holds a live, unrevoked permission from `party` with `scope`.
export async function requirePartyScope(
  caller: ApiCaller,
  party: Address,
  scope: ScopeName,
  store: TenantStore,
  nowSeconds: bigint,
): Promise<void> {
  const permissions = await store.permissionsFor(caller.tenantId, caller.chainId, party);
  const allowed = permissions.some((p) => !p.revoked && p.expiresAt > nowSeconds && hasScope(p.scopes, scope));
  if (!allowed) throw new ApiError(404, "not_found", "Not found.");
}
