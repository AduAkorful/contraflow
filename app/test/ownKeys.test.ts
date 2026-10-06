import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { hashApiKey, keyMode } from "../src/api/keys";
import {
  createTestKeyForOwner,
  ownKeyIssueError,
  ownKeyPrefixOk,
  ownKeyRevokeError,
  revokeKeyForOwner,
  type IssueOutcome,
  type OwnKeyStore,
} from "../src/api/ownKeys";

const OWNER = getAddress(`0x${"11".repeat(20)}`);

function store(outcome: IssueOutcome): OwnKeyStore & { inputPrefix: string } {
  const seen = { inputPrefix: "" };
  return {
    get inputPrefix() {
      return seen.inputPrefix;
    },
    async issueTestKey(input) {
      seen.inputPrefix = input.prefix;
      expect(input.owner).toBe(OWNER.toLowerCase());
      expect(input.name.startsWith("Self-serve ")).toBe(true);
      expect(input.keyHash).toMatch(/^[0-9a-f]{64}$/);
      return outcome;
    },
    async list() {
      return null;
    },
    async revoke() {
      return "not_found";
    },
  };
}

describe("self-serve API keys", () => {
  it("issues a test key and returns the secret once", async () => {
    const backing = store("issued");
    const result = await createTestKeyForOwner(OWNER, backing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.key.startsWith("cfk_test_")).toBe(true);
    expect(keyMode(result.key)).toBe("test");
    expect(result.prefix).toBe(result.key.slice(0, 13));
    expect(result.prefix).toBe(backing.inputPrefix);
    expect(hashApiKey(result.key)).toMatch(/^[0-9a-f]{64}$/);
    expect(result.key).not.toBe(result.prefix);
  });

  it("refuses a third active key and a suspended tenant", () => {
    expect(ownKeyIssueError("at_cap")).toMatch(/two active keys/);
    expect(ownKeyIssueError("suspended")).toMatch(/suspended/);
    expect(ownKeyIssueError("unavailable")).toMatch(/aren't available/);
  });

  it("rejects a prefix that is not the stored display form", async () => {
    expect(ownKeyPrefixOk("cfk_test_abcd")).toBe(true);
    expect(ownKeyPrefixOk("cfk_live_abcd")).toBe(true);
    expect(ownKeyPrefixOk("cfk_test_")).toBe(false);
    expect(ownKeyPrefixOk(`cfk_test_${"a".repeat(43)}`)).toBe(false);
    const calls: string[] = [];
    const backing: OwnKeyStore = {
      async issueTestKey() {
        return "issued";
      },
      async list() {
        return null;
      },
      async revoke(_owner, prefix) {
        calls.push(prefix);
        return "revoked";
      },
    };
    const refused = await revokeKeyForOwner(OWNER, "not-a-prefix", backing);
    expect(refused).toEqual({ ok: false, error: ownKeyRevokeError("not_found") });
    expect(calls).toEqual([]);
  });

  it("lowercases a checksummed owner before revoke", async () => {
    let seen = "";
    const backing: OwnKeyStore = {
      async issueTestKey() {
        return "issued";
      },
      async list() {
        return null;
      },
      async revoke(owner) {
        seen = owner;
        return "revoked";
      },
    };
    const mixed = getAddress(OWNER) as Address;
    await revokeKeyForOwner(mixed, "cfk_test_abcd", backing);
    expect(seen).toBe(OWNER.toLowerCase());
  });
});
