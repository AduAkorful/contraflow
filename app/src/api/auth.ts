/// Who is calling, and may they act for this party? Every API route starts here. Keys decide the
/// chain; permissions decide which parties a tenant can reach. A non-party and a party without a
/// live permission look the same to the caller: "Not found", as in the web app.

import type { Address, Hex } from "viem";
import { addressesForChain } from "../contracts/addresses";
import { chainIdForMode, hashApiKey, keyMode, type KeyMode } from "./keys";
import { hasScope, type ScopeName } from "./permissions";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
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

export interface TenantStore {
  findKey(hash: string): Promise<StoredKey | null>;
  /// False when a permission with the same tenant, chain, party and nonce already exists.
  savePermission(permission: NewPermission): Promise<boolean>;
  permissionsFor(tenantId: Hex, chainId: number, party: Address): Promise<StoredPermission[]>;
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
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!match) throw UNAUTHORIZED;
  const key = match[1]!;
  const mode = keyMode(key);
  if (!mode) throw UNAUTHORIZED;

  const stored = await store.findKey(hashApiKey(key));
  if (!stored || stored.revoked || !stored.tenantActive || stored.mode !== mode) throw UNAUTHORIZED;

  const chainId = chainIdForMode(mode);
  if (!chainDeployed(chainId)) {
    throw new ApiError(403, "live_unavailable", "Live keys work once Contraflow is on Arc mainnet. Use a test key.");
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
