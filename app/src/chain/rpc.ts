/// Which RPC endpoints the server uses for a chain.
///
/// Point reads, simulation and sending go to `ARC_RPC` (a keyed provider such as Alchemy) first and
/// fall back to Arc's documented public endpoints. Log scans use `ARC_LOGS_RPC` and then the public
/// endpoints only: keyed free plans cap `eth_getLogs` at a handful of blocks, which the indexer's
/// 9,999-block ranges would exceed. URLs come from the deployment's environment, never from a
/// request. Browser bundles can't see these variables and use the chain's default endpoint.

import { APP_CHAIN_ID, ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

/// Arc's documented free endpoints (docs.arc.io "Connect to Arc"). Each accepts JSON-RPC batches
/// and `eth_getLogs` over 9,999 blocks (measured 2026-10-11).
const OFFICIAL_RPC_URLS: Record<number, readonly string[]> = {
  [ARC_MAINNET_CHAIN_ID]: [
    "https://rpc.mainnet.arc.io",
    "https://rpc.blockdaemon.mainnet.arc.io",
    "https://rpc.quicknode.mainnet.arc.io",
  ],
  [ARC_TESTNET_CHAIN_ID]: [
    "https://rpc.testnet.arc.io",
    "https://rpc.blockdaemon.testnet.arc.io",
    "https://rpc.quicknode.testnet.arc.io",
  ],
};

function splitUrls(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => /^https:\/\//.test(v));
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}

/// The configured primary endpoint for a chain, if any. `ARC_RPC` belongs to the chain this
/// deployment serves; `ARC_TESTNET_RPC` is the testnet's own endpoint wherever testnet is used
/// (the demo, a testnet deployment), and the older name for `ARC_RPC` on a testnet deployment.
function configuredPrimary(chainId: number): string[] {
  const env = process.env;
  if (chainId === ARC_TESTNET_CHAIN_ID) {
    return splitUrls(APP_CHAIN_ID === ARC_TESTNET_CHAIN_ID ? env.ARC_RPC : undefined).concat(splitUrls(env.ARC_TESTNET_RPC));
  }
  if (chainId === APP_CHAIN_ID) return splitUrls(env.ARC_RPC);
  return [];
}

/// Endpoints for point reads and sending, in the order they are tried.
export function rpcUrlsFor(chainId: number): string[] {
  return dedupe([...configuredPrimary(chainId), ...(OFFICIAL_RPC_URLS[chainId] ?? [])]);
}

/// Endpoints for `eth_getLogs` scans, in the order they are tried.
export function logsRpcUrlsFor(chainId: number): string[] {
  const own = chainId === APP_CHAIN_ID || chainId === ARC_TESTNET_CHAIN_ID ? splitUrls(process.env.ARC_LOGS_RPC) : [];
  return dedupe([...own, ...(OFFICIAL_RPC_URLS[chainId] ?? [])]);
}
