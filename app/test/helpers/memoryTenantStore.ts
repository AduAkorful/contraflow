/// In-memory `TenantStore` for API tests, with the same uniqueness and revocation rules as Neon.

import type { Hex } from "viem";
import type { NewPermission, StoredKey, StoredPermission, TenantStore } from "../../src/api/auth";

export type MemoryTenantStore = TenantStore & { permissions: (StoredPermission & { nonce: Hex })[] };

export function memoryTenantStore(keys: Record<string, StoredKey> = {}): MemoryTenantStore {
  const permissions: (StoredPermission & { nonce: Hex })[] = [];
  return {
    permissions,
    findKey: async (hash) => keys[hash] ?? null,
    savePermission: async (p: NewPermission) => {
      const same = (x: StoredPermission & { nonce: Hex }) =>
        x.tenantId === p.tenantId && x.chainId === p.chainId && x.party === p.party && x.nonce === p.nonce;
      if (permissions.some(same)) return false;
      permissions.push({ ...p, revoked: false });
      return true;
    },
    permissionsFor: async (tenantId, chainId, party) =>
      permissions.filter((p) => p.tenantId === tenantId && p.chainId === chainId && p.party === party),
    revokePermission: async (tenantId, id) => {
      const p = permissions.find((x) => x.permissionId === id && x.tenantId === tenantId && !x.revoked);
      if (!p) return false;
      p.revoked = true;
      return true;
    },
  };
}
