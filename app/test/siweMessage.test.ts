import { describe, expect, it } from "vitest";
import { buildSiweMessage } from "../src/siwe/message";

const BASE_PARAMS = {
  domain: "localhost:3000",
  address: "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C" as const,
  statement: "Sign in to Contraflow.",
  uri: "https://localhost:3000",
  chainId: 5042002,
  nonce: "abc123def456",
  issuedAt: "2026-09-21T18:00:00.000Z",
  expirationTime: "2026-09-21T18:05:00.000Z",
};

describe("buildSiweMessage", () => {
  it("matches the EIP-4361 message format exactly", () => {
    const message = buildSiweMessage(BASE_PARAMS);
    expect(message).toBe(
      "localhost:3000 wants you to sign in with your Ethereum account:\n" +
        "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C\n" +
        "\n" +
        "Sign in to Contraflow.\n" +
        "\n" +
        "URI: https://localhost:3000\n" +
        "Version: 1\n" +
        "Chain ID: 5042002\n" +
        "Nonce: abc123def456\n" +
        "Issued At: 2026-09-21T18:00:00.000Z\n" +
        "Expiration Time: 2026-09-21T18:05:00.000Z",
    );
  });

  it("places the address on its own line, second line of the message", () => {
    const message = buildSiweMessage(BASE_PARAMS);
    const lines = message.split("\n");
    expect(lines[1]).toBe(BASE_PARAMS.address);
  });

  it("changes output when the nonce changes, and nothing else does", () => {
    const a = buildSiweMessage(BASE_PARAMS);
    const b = buildSiweMessage({ ...BASE_PARAMS, nonce: "different-nonce" });
    expect(a).not.toBe(b);
    expect(a.replace(BASE_PARAMS.nonce, "X")).toBe(b.replace("different-nonce", "X"));
  });
});
