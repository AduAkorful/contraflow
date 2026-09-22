/// Chain-id-keyed contract registry. Populated with real addresses once a deploy exists for that
/// chain — never hardcoded inline in UI components, so a testnet deploy and the eventual mainnet
/// deploy can coexist without a find-and-replace.

export interface ChainAddresses {
  registry: `0x${string}`;
  settler: `0x${string}`;
  usdc: `0x${string}`;
  /// The registry proxy's deployment block — the earliest block any `InvoiceRegistered` event for
  /// this deployment can exist at. Used as a floor for event-log scans (e.g. `readNextNonce`) so
  /// they never need to scan from block 0, which this project's public Arc testnet RPC rejects
  /// ("pruned history unavailable").
  registryDeployBlock: bigint;
}

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_MAINNET_CHAIN_ID = 5042;

/// `registryDeployBlock` is read directly from the deploy broadcast's transaction receipts, not
/// hand-typed. This is a fresh deployment, not an upgrade of any prior one — a previous testnet
/// deployment's history stays permanently on-chain and inspectable under its own addresses, just
/// no longer what this app points at.
const ARC_TESTNET_ADDRESSES: ChainAddresses = {
  registry: "0x304450Dc27f644AcA55773895409ff500AFb2Bf7",
  settler: "0x25851c3fa9438AA53B0bd6ecc3347010b3ccB015",
  usdc: "0x3600000000000000000000000000000000000000",
  registryDeployBlock: 63390626n,
};

const ADDRESSES_BY_CHAIN_ID: Record<number, ChainAddresses> = {
  [ARC_TESTNET_CHAIN_ID]: ARC_TESTNET_ADDRESSES,
  // [ARC_MAINNET_CHAIN_ID]: not deployed yet.
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
