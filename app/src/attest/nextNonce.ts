/// Real-mode nonce resolution. Deliberately NOT `src/chain/readInvoices.ts`'s `readNextNonce`
/// (raw `eth_getLogs` from a block): that function is correct for the demo's fresh-per-run
/// identities (provably nonce 1), but real parties are reused addresses, so a genuine history is
/// required, and the registry-deploy-block-to-now gap exceeds the public RPC's range cap on a
/// single call. The chain index (`src/chainindex/`) keeps the largest nonce per pair from the
/// Registry's own events, read from the chain with no block explorer in the path.
///
/// Throws `ChainIndexBehindError` when the index can't be brought up to the head: a nonce is never
/// guessed.

import type { Address } from "viem";
import { APP_CHAIN_ID } from "../contracts/addresses";
import { indexedNextNonce } from "../chainindex/source";

/// The next nonce `register()` will accept for this exact (debtor, creditor) pair: the largest
/// nonce registered for it plus one, or `1` for a pair with no history.
export async function resolveNextNonce(debtor: Address, creditor: Address): Promise<bigint> {
  return indexedNextNonce(APP_CHAIN_ID, debtor, creditor);
}
