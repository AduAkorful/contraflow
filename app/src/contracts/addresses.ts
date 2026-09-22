/// Chain-id-keyed contract registry, per `plans/00-architecture.md` §8. Populated with real
/// addresses once a deploy exists for that chain — never hardcoded inline in UI components, so a
/// testnet rehearsal deploy and the eventual mainnet deploy can coexist without a find-and-replace.

export interface ChainAddresses {
  registry: `0x${string}`;
  settler: `0x${string}`;
  usdc: `0x${string}`;
  /// The registry proxy's deployment block — the earliest block any `InvoiceRegistered` event for
  /// this deployment can exist at. Used as a floor for event-log scans (e.g. `readNextNonce`) so
  /// they never need to scan from block 0, which this project's public Arc testnet RPC rejects
  /// ("pruned history unavailable" — confirmed live 2026-09-21, plans/16-app-demo.md).
  registryDeployBlock: bigint;
}

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_MAINNET_CHAIN_ID = 5042;

/// Source: `plans/02-deploy-testnet.md` "Testnet deployment record" / `contracts/deployments/testnet.json`.
/// `registryDeployBlock` read directly from `contracts/broadcast/Deploy.s.sol/5042002/run-latest.json`'s
/// receipts, not hand-typed.
const ARC_TESTNET_ADDRESSES: ChainAddresses = {
  registry: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312",
  settler: "0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03",
  usdc: "0x3600000000000000000000000000000000000000",
  registryDeployBlock: 62699872n,
};

const ADDRESSES_BY_CHAIN_ID: Record<number, ChainAddresses> = {
  [ARC_TESTNET_CHAIN_ID]: ARC_TESTNET_ADDRESSES,
  // [ARC_MAINNET_CHAIN_ID]: not deployed yet — deferred per the 2026-09-18 sequencing decision.
};

export class UnknownChainError extends Error {
  constructor(chainId: number) {
    super(`No Contraflow deployment recorded for chain id ${chainId}`);
    this.name = "UnknownChainError";
  }
}

export function addressesForChain(chainId: number): ChainAddresses {
  const addresses = ADDRESSES_BY_CHAIN_ID[chainId];
  if (!addresses) throw new UnknownChainError(chainId);
  return addresses;
}
