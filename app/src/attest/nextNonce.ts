/// Real-mode nonce resolution. Deliberately NOT `src/chain/readInvoices.ts`'s `readNextNonce`
/// (raw `eth_getLogs`): that function is correct for the demo's fresh-per-run identities
/// (provably nonce 1, `fromBlock` barely matters) but real parties are reused addresses, so a
/// genuine scan is required — and the registry-deploy-block-to-now gap can easily exceed the
/// public RPC's confirmed block-range cap on a single `eth_getLogs` call. Reuses the Blockscout
/// pagination already built for reconciliation, which has no such cap.

import type { Address } from "viem";
import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { fetchContractLogs } from "../blockscout/client";
import { parseRegistered } from "../blockscout/reconcile";

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/// The next nonce `register()` will accept for this exact (debtor, creditor) pair — same formula
/// as `readNextNonce` (`max(nonce) + 1`, defaulting to `1` for a pair with no prior history), just
/// sourced from Blockscout's decoded log history instead of a direct RPC scan.
export async function resolveNextNonce(debtor: Address, creditor: Address): Promise<bigint> {
  const { registry } = addressesForChain(ARC_TESTNET_CHAIN_ID);
  const logs = await fetchContractLogs(registry);

  let maxNonce = 0n;
  for (const log of logs) {
    const parsed = parseRegistered(log);
    if (!parsed) continue;
    if (!sameAddress(parsed.debtor, debtor) || !sameAddress(parsed.creditor, creditor)) continue;
    if (parsed.nonce > maxNonce) maxNonce = parsed.nonce;
  }

  return maxNonce + 1n;
}
