import { describe, expect, it } from "vitest";
import { hashTypedData } from "viem";
import { typedDataResponse } from "../src/api/typedDataJson";
import { permissionTypedData } from "../src/api/permissions";

const CHAIN = 5042002;
const permission = {
  party: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  tenantId: `0x${"ab".repeat(32)}` as `0x${string}`,
  scopes: 7,
  expiresAt: 1_800_000_060n,
  nonce: `0x${"11".repeat(32)}` as `0x${string}`,
};

describe("typedDataResponse", () => {
  it("emits chainId as a JSON number whose viem hash matches digest", () => {
    const original = permissionTypedData(CHAIN, permission);
    const envelope = typedDataResponse(original);
    expect(envelope.typedData.domain.chainId).toBe(CHAIN);
    expect(hashTypedData(envelope.typedData as never)).toBe(envelope.digest);
    expect(hashTypedData(original)).toBe(envelope.digest);
  });

  it("differs from an ethers-style string chainId", () => {
    const envelope = typedDataResponse(permissionTypedData(CHAIN, permission));
    const asString = {
      ...envelope.typedData,
      domain: { ...envelope.typedData.domain, chainId: String(CHAIN) },
    };
    expect(hashTypedData(asString as never)).not.toBe(envelope.digest);
  });
});
