/// Explorer per chain. Mainnet is added with the mainnet deploy, from a URL verified live then.
const BLOCKSCOUT_BASE_BY_CHAIN_ID: Record<number, string> = {
  5042002: "https://explorer.testnet.arc.io",
};

export function blockscoutBaseFor(chainId: number): string {
  const base = BLOCKSCOUT_BASE_BY_CHAIN_ID[chainId];
  if (!base) throw new Error(`No Blockscout explorer configured for chain ${chainId}`);
  return base;
}

/// Address page on the chain's explorer, or null when no explorer is configured for it.
export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = BLOCKSCOUT_BASE_BY_CHAIN_ID[chainId];
  return base ? `${base}/address/${address}` : null;
}
