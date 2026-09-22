/// Real-mode nonce resolution — plans/21-real-mode-attest-flow.md design decision 1. Deliberately
/// NOT `src/chain/readInvoices.ts`'s `readNextNonce` (raw `eth_getLogs`): that function is correct
/// for the demo's fresh-per-run identities (provably nonce 1, `fromBlock` barely matters) but real
/// parties are reused addresses, so a genuine scan is required — and the registry-deploy-block-to-
/// now gap is now ~590,000 blocks, well past the public RPC's confirmed ~9,500-block
/// `eth_getLogs` cap (`plans/16-app-demo.md`). Reuses the Blockscout pagination already built and
/// verified for reconciliation (`plans/19-database-blockscout-reconciliation.md`), which has no
/// such cap.

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
