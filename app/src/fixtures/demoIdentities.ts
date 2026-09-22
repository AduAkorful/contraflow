/// Per-run burner identities for the `/app/demo` fixture (plans/16-app-demo.md), generalized to a
/// configurable party count (plans/17-app-demo-n-party.md). Each demo run derives fresh addresses,
/// salted with a random run id, rather than reusing one fixed set — deliberately, not an
/// oversight: a truly fresh address is provably at nonce 1 with a trivial, near-instant on-chain
/// check (no prior event can exist for an address that's never been derived before), sidestepping
/// `readNextNonce`'s full-history event scan entirely. Arc testnet's public RPC both rejects
/// scanning from block 0 ("pruned history unavailable") and caps any single `eth_getLogs` range at
/// a few thousand blocks ("requested range too large") — both confirmed live 2026-09-21 — so a
/// fixed, reused identity set would need an ever-growing chain of chunked scans as the deployment
/// ages. Per-run identities also mean two concurrent demo runs never contend for the same nonce.

import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/// `ContraflowSettler.MIN_CYCLE_LENGTH` / `MAX_CYCLE_LENGTH` — a real on-chain constant
/// (`contracts/src/ContraflowSettler.sol`), not a UI-invented limit. `settle()` reverts
/// `CycleLengthInvalid(n)` outside this range, so the demo's party-count picker must stay inside
/// it too.
export const MIN_DEMO_PARTIES = 3;
export const MAX_DEMO_PARTIES = 5;

export interface DemoParty {
  label: string;
  address: Address;
  privateKey: Hex;
}

/// The spec's own documented 3-node fixture (`plans/contraflow-spec.md` §7, "Phase 1 fixture"):
/// Northwind DSP -> Meridian Exchange -> Atlas Publisher -> Northwind DSP. Used verbatim when the
/// party count is exactly 3, so the default demo experience matches what the spec describes.
/// Any other count (4 or 5) uses generic, obviously-synthetic labels instead of inventing more
/// fake company names beyond what the spec actually documents.
const NAMED_TRIO = ["Northwind DSP", "Meridian Exchange", "Atlas Publisher"];

function partyLabel(index: number, count: number): string {
  return count === 3 ? NAMED_TRIO[index]! : `Party ${index + 1}`;
}

function demoPartyPrivateKey(index: number, runSalt: string): Hex {
  return keccak256(toHex(`contraflow-demo-party-${index}-${runSalt}`));
}

/// `runSalt` should be unique per demo run (e.g. `crypto.randomUUID()`) — reusing a salt reuses
/// the same addresses, reintroducing exactly the nonce-history problem this design avoids.
/// `count` must be within [MIN_DEMO_PARTIES, MAX_DEMO_PARTIES] — callers enforce this against the
/// real contract constant, not an arbitrary UI choice.
export function deriveDemoParties(runSalt: string, count: number): DemoParty[] {
  if (count < MIN_DEMO_PARTIES || count > MAX_DEMO_PARTIES) {
    throw new Error(`deriveDemoParties: count must be ${MIN_DEMO_PARTIES}-${MAX_DEMO_PARTIES}, got ${count}`);
  }
  return Array.from({ length: count }, (_, i) => {
    const privateKey = demoPartyPrivateKey(i, runSalt);
    return { label: partyLabel(i, count), address: privateKeyToAccount(privateKey).address, privateKey };
  });
}
