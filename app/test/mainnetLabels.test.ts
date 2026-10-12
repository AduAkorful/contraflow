import { describe, expect, it } from "vitest";
import { arcNetworkName } from "../src/chain/client";
import { explorerTxUrl } from "../src/blockscout/explorer";
import { authenticate } from "../src/api/auth";

describe("network labels and links follow the chain", () => {
  it("names the network from the chain id", () => {
    expect(arcNetworkName(5042)).toBe("Arc");
    expect(arcNetworkName(5042002)).toBe("Arc Testnet");
  });

  it("builds transaction links on the mainnet explorer for mainnet and the testnet one for testnet", () => {
    expect(explorerTxUrl(5042, "0xabc")).toBe("https://explorer.arc.io/tx/0xabc");
    expect(explorerTxUrl(5042002, "0xabc")).toBe("https://explorer.testnet.arc.io/tx/0xabc");
  });
});

describe("authenticate checks a key's network before looking it up", () => {
  it("answers a key for the other network with its 403 even when no such key is stored", async () => {
    const store = { findKey: async () => null } as never;
    // The deployment under test serves testnet, so a live key is the "other" network.
    const err = await authenticate("Bearer cfk_live_" + "a".repeat(43), store).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe("live_unavailable");
  });
});
