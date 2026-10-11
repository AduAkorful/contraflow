import { chainById } from "../chain/client";

/// Explorer API per chain, used by server code that reads Blockscout. Mainnet is added only after
/// the API answers live (it still returns a Cloudflare challenge to automated requests).
const BLOCKSCOUT_BASE_BY_CHAIN_ID: Record<number, string> = {
  5042002: "https://explorer.testnet.arc.io",
};

export function blockscoutBaseFor(chainId: number): string {
  const base = BLOCKSCOUT_BASE_BY_CHAIN_ID[chainId];
  if (!base) throw new Error(`No Blockscout explorer configured for chain ${chainId}`);
  return base;
}

/// Where a person's browser can open an explorer page: the verified API base if there is one,
/// otherwise the chain's published explorer. A challenge that blocks our server's requests doesn't
/// apply to a person clicking a link.
function pageBaseFor(chainId: number): string | null {
  const verified = BLOCKSCOUT_BASE_BY_CHAIN_ID[chainId];
  if (verified) return verified;
  try {
    return chainById(chainId).blockExplorers?.default.url ?? null;
  } catch {
    return null;
  }
}

/// Address page on the chain's explorer, or null when no explorer is configured for it.
export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = pageBaseFor(chainId);
  return base ? `${base}/address/${address}` : null;
}

/// Transaction page on the chain's explorer, or null when no explorer is configured for it.
export function explorerTxUrl(chainId: number, hash: string): string | null {
  const base = pageBaseFor(chainId);
  return base ? `${base}/tx/${hash}` : null;
}
