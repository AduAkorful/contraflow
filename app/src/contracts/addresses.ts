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
  /// `ContraflowNettingLedger` proxy for offchain obligations. Deployed independently of the
  /// Registry and Settler, so it has its own deployment record
  /// (`contracts/deployments/testnet-netting-ledger.json`).
  nettingLedger: `0x${string}`;
}

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_MAINNET_CHAIN_ID = 5042;
/// The chain this deployment serves, fixed at build time from `NEXT_PUBLIC_ARC_NETWORK` (the
/// variable is public because client components read this constant). Anything other than the exact
/// value `mainnet` is testnet, so a typo can never select mainnet.
export const APP_CHAIN_ID = process.env.NEXT_PUBLIC_ARC_NETWORK === "mainnet" ? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID;

/// `registryDeployBlock` is read directly from the deploy broadcast's transaction receipts, not
/// hand-typed. This is a fresh deployment, not an upgrade of any prior one — a previous testnet
/// deployment's history stays permanently on-chain and inspectable under its own addresses, just
/// no longer what this app points at.
const ARC_TESTNET_ADDRESSES: ChainAddresses = {
  registry: "0x304450Dc27f644AcA55773895409ff500AFb2Bf7",
  settler: "0x25851c3fa9438AA53B0bd6ecc3347010b3ccB015",
  usdc: "0x3600000000000000000000000000000000000000",
  registryDeployBlock: 63390626n,
  nettingLedger: "0x2F5996aaE68CbC8026543c405Cc81C26D58c2ef7",
};

/// From Foundry's broadcast output for chain 5042 (`scripts/addresses-from-broadcast.mjs`),
/// confirmed with `cast`. The Registry and Settler proxies share addresses with the 2026-09-18
/// testnet deployment because the same deployer sent them from nonce 0 on each chain; the chain id is
/// part of every signed domain, so nothing signed for one can be used on the other.
const ARC_MAINNET_ADDRESSES: ChainAddresses = {
  registry: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312",
  settler: "0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03",
  usdc: "0x3600000000000000000000000000000000000000",
  registryDeployBlock: 25469818n,
  nettingLedger: "0xCf7759128399ACF6f69dd76c852074ed9050fc28",
};

const ADDRESSES_BY_CHAIN_ID: Record<number, ChainAddresses> = {
  [ARC_TESTNET_CHAIN_ID]: ARC_TESTNET_ADDRESSES,
  [ARC_MAINNET_CHAIN_ID]: ARC_MAINNET_ADDRESSES,
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
