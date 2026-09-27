/// API keys: `cfk_test_` or `cfk_live_` plus 32 random bytes, base64url. Only a SHA-256 hash is
/// stored, so a database leak doesn't hand out working keys. The mode in the key decides the chain.

import { createHash, randomBytes } from "node:crypto";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

export type KeyMode = "test" | "live";

const KEY_BYTES = 32;
const PREFIX: Record<KeyMode, string> = { test: "cfk_test_", live: "cfk_live_" };
const KEY_PATTERN = /^cfk_(test|live)_[A-Za-z0-9_-]{43}$/;
/// Enough of the key to recognise it in a list, never enough to use it.
const DISPLAY_PREFIX_CHARS = 13;

export interface IssuedKey {
  key: string;
  hash: string;
  displayPrefix: string;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function issueApiKey(mode: KeyMode): IssuedKey {
  const key = PREFIX[mode] + randomBytes(KEY_BYTES).toString("base64url");
  return { key, hash: hashApiKey(key), displayPrefix: key.slice(0, DISPLAY_PREFIX_CHARS) };
}

/// Null for anything that isn't shaped like one of our keys, so it's rejected before any lookup.
export function keyMode(key: string): KeyMode | null {
  const match = KEY_PATTERN.exec(key);
  return match ? (match[1] as KeyMode) : null;
}

export function chainIdForMode(mode: KeyMode): number {
  return mode === "test" ? ARC_TESTNET_CHAIN_ID : ARC_MAINNET_CHAIN_ID;
}
