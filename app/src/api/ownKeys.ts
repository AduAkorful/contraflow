/// Self-serve API keys. A signed-in address owns one tenant and may hold two active keys.
/// The key is a tenant credential: Contraflow still never signs for that tenant.
/// Only a SHA-256 hash is stored. The secret is returned once, to the action that created it.

import { randomBytes } from "node:crypto";
import { getAddress, type Address } from "viem";
import { APP_CHAIN_ID, ARC_MAINNET_CHAIN_ID } from "../contracts/addresses";
import { hashApiKey, issueApiKey, type IssuedKey, type KeyMode } from "./keys";

export const MAX_ACTIVE_OWN_KEYS = 2;

/// `cfk_test_` / `cfk_live_` (9 chars) plus the 4 characters stored for display.
const PREFIX_PATTERN = /^cfk_(test|live)_[A-Za-z0-9_-]{4}$/;

export type IssueOutcome = "issued" | "at_cap" | "suspended" | "unavailable";
export type RevokeOutcome = "revoked" | "not_found" | "ambiguous";

export interface OwnKeyView {
  prefix: string;
  mode: "test" | "live";
  createdAt: string;
  revoked: boolean;
}

export interface OwnTenantView {
  tenantId: string;
  status: "active" | "suspended";
  keys: OwnKeyView[];
}

export interface IssueKeyInput {
  owner: string;
  mode: KeyMode;
  tenantId: string;
  name: string;
  keyHash: string;
  prefix: string;
}

export interface OwnKeyStore {
  issueKey(input: IssueKeyInput): Promise<IssueOutcome>;
  list(owner: string): Promise<OwnTenantView | null>;
  revoke(owner: string, prefix: string): Promise<RevokeOutcome>;
}

export type OwnKeyResult = { ok: true; key: string; prefix: string } | { ok: false; error: string };

export function ownKeyPrefixOk(prefix: string): boolean {
  return PREFIX_PATTERN.test(prefix);
}

export function ownKeyIssueError(outcome: Exclude<IssueOutcome, "issued">): string {
  if (outcome === "at_cap") return "You already have two active keys. Revoke one to create another.";
  if (outcome === "suspended") return "This API access is suspended.";
  return "API keys aren't available right now.";
}

export function ownKeyRevokeError(outcome: Exclude<RevokeOutcome, "revoked">): string {
  if (outcome === "ambiguous") return "That prefix matches more than one key. Nothing was revoked.";
  return "No active key with that prefix.";
}

function ownerLower(owner: Address): string {
  return getAddress(owner).toLowerCase();
}

/// The kind of key a signed-in address creates for itself: the one that acts on the chain this
/// deployment serves (`live` on mainnet, `test` on testnet), never the other.
export function selfServeKeyMode(): KeyMode {
  return APP_CHAIN_ID === ARC_MAINNET_CHAIN_ID ? "live" : "test";
}

/// Issues a key of `mode` for the signed-in owner (`cfk_test_` or `cfk_live_`).
export async function createKeyForOwner(
  owner: Address,
  store: OwnKeyStore,
  mode: KeyMode = selfServeKeyMode(),
  issue: () => IssuedKey = () => issueApiKey(mode),
): Promise<OwnKeyResult> {
  const ownerAddress = ownerLower(owner);
  const issued = issue();
  if (!issued.key.startsWith(`cfk_${mode}_`) || issued.hash !== hashApiKey(issued.key)) {
    return { ok: false, error: "API keys aren't available right now." };
  }
  const outcome = await store.issueKey({
    owner: ownerAddress,
    mode,
    tenantId: `0x${randomBytes(32).toString("hex")}`,
    name: `Self-serve ${ownerAddress.slice(2, 8)}`,
    keyHash: issued.hash,
    prefix: issued.displayPrefix,
  });
  if (outcome !== "issued") return { ok: false, error: ownKeyIssueError(outcome) };
  return { ok: true, key: issued.key, prefix: issued.displayPrefix };
}

export async function revokeKeyForOwner(owner: Address, prefix: string, store: OwnKeyStore): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ownKeyPrefixOk(prefix)) return { ok: false, error: ownKeyRevokeError("not_found") };
  const outcome = await store.revoke(ownerLower(owner), prefix);
  if (outcome !== "revoked") return { ok: false, error: ownKeyRevokeError(outcome) };
  return { ok: true };
}
