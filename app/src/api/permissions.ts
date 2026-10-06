/// A party's signed permission for a tenant to act for it. Scopes let a tenant read the party's
/// obligations, propose new ones naming it, and deliver signatures the party made. Nothing here
/// lets a tenant sign: every obligation and certificate still needs the party's own signature.

import { hashTypedData, isAddress, isHex, getAddress, type Address, type Hex } from "viem";
import { checkSignature, type ChainReader } from "../netting/signature";

export const SCOPE = { read: 1, propose: 2, deliverSignatures: 4 } as const;
export type ScopeName = keyof typeof SCOPE;
const ALL_SCOPES = SCOPE.read | SCOPE.propose | SCOPE.deliverSignatures;

/// A permission can't outlive a year; parties re-grant rather than hand out open-ended access.
export const MAX_PERMISSION_SECONDS = 365n * 24n * 60n * 60n;

export const PERMISSION_DOMAIN_NAME = "Contraflow API";
export const PERMISSION_DOMAIN_VERSION = "1";

export const PERMISSION_TYPES = {
  ContraflowTenantPermission: [
    { name: "party", type: "address" },
    { name: "tenantId", type: "bytes32" },
    { name: "scopes", type: "uint8" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface TenantPermission {
  party: Address;
  tenantId: Hex;
  scopes: number;
  expiresAt: bigint;
  nonce: Hex;
}

export function permissionDomain(chainId: number) {
  return { name: PERMISSION_DOMAIN_NAME, version: PERMISSION_DOMAIN_VERSION, chainId: BigInt(chainId) } as const;
}

/// The exact typed data a party signs, for the API to hand to the tenant.
export function permissionTypedData(chainId: number, permission: TenantPermission) {
  return {
    domain: permissionDomain(chainId),
    types: PERMISSION_TYPES,
    primaryType: "ContraflowTenantPermission" as const,
    message: permission,
  };
}

export function permissionDigest(chainId: number, permission: TenantPermission): Hex {
  return hashTypedData(permissionTypedData(chainId, permission));
}

export function hasScope(scopes: number, scope: ScopeName): boolean {
  return (scopes & SCOPE[scope]) !== 0;
}

export type PermissionResult = { ok: true; permission: TenantPermission } | { ok: false; error: string };

/// Field checks shared by GET /permissions/typed-data (no signature yet) and POST /permissions.
export function parsePermissionGrant(
  input: unknown,
  ctx: { tenantId: Hex; nowSeconds: bigint },
): PermissionResult {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Permission must be an object." };
  const raw = input as Record<string, unknown>;

  if (typeof raw.party !== "string" || !isAddress(raw.party)) return { ok: false, error: "party must be an address." };
  if (typeof raw.tenantId !== "string" || raw.tenantId.toLowerCase() !== ctx.tenantId.toLowerCase()) {
    return { ok: false, error: "tenantId must be your own tenant ID." };
  }
  const scopes = raw.scopes;
  if (typeof scopes !== "number" || !Number.isInteger(scopes) || scopes <= 0 || (scopes & ~ALL_SCOPES) !== 0) {
    return { ok: false, error: "scopes must combine read (1), propose (2) and deliverSignatures (4)." };
  }
  let expiresAt: bigint;
  try {
    expiresAt = BigInt(raw.expiresAt as string | number);
  } catch {
    return { ok: false, error: "expiresAt must be a unix timestamp." };
  }
  if (expiresAt <= ctx.nowSeconds) return { ok: false, error: "This permission has already expired." };
  if (expiresAt > ctx.nowSeconds + MAX_PERMISSION_SECONDS) {
    return { ok: false, error: "A permission can last at most one year." };
  }
  if (typeof raw.nonce !== "string" || !isHex(raw.nonce) || raw.nonce.length !== 66) {
    return { ok: false, error: "nonce must be 32 bytes of hex." };
  }

  return {
    ok: true,
    permission: {
      party: getAddress(raw.party),
      tenantId: ctx.tenantId,
      scopes,
      expiresAt,
      nonce: raw.nonce as Hex,
    },
  };
}

/// Parses untrusted input and checks the grant fully, including the signature against the chain.
/// A signature that can't be checked counts as a failure, as everywhere else in Mode B.
export async function validatePermission(
  input: unknown,
  signature: unknown,
  ctx: { chainId: number; tenantId: Hex; nowSeconds: bigint; client: ChainReader },
): Promise<PermissionResult> {
  const parsed = parsePermissionGrant(input, ctx);
  if (!parsed.ok) return parsed;
  if (typeof signature !== "string" || !isHex(signature)) return { ok: false, error: "signature must be hex." };

  const { permission } = parsed;
  const check = await checkSignature(permission.party, permissionDigest(ctx.chainId, permission), signature, ctx.client);
  if (check.status !== "pass") return { ok: false, error: `The permission isn't signed by ${permission.party}.` };
  return { ok: true, permission };
}
