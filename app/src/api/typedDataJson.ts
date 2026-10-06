/// EIP-712 payloads on the wire: `domain.chainId` is a JSON number so viem hashes the response
/// as-is. Other integers stay decimal strings. `digest` is the hash of the original typed data,
/// so a client can compare without re-serializing.

import { hashTypedData, type Hex } from "viem";
import { jsonSafe } from "./json";

export interface TypedDataEnvelope {
  typedData: {
    domain: Record<string, unknown>;
    types: unknown;
    primaryType: string;
    message: unknown;
  };
  digest: Hex;
}

export function typedDataResponse(payload: {
  domain: { chainId: bigint | number };
  types: object;
  primaryType: string;
  message: object;
}): TypedDataEnvelope {
  const chainId = Number(payload.domain.chainId);
  if (!Number.isSafeInteger(chainId) || chainId < 0) {
    throw new Error("chainId exceeds JSON number range");
  }
  const digest = hashTypedData({
    ...payload,
    domain: { ...payload.domain, chainId: BigInt(payload.domain.chainId) },
  } as never);
  const domain = jsonSafe(payload.domain) as Record<string, unknown>;
  domain.chainId = chainId;
  return {
    typedData: {
      domain,
      types: payload.types,
      primaryType: payload.primaryType,
      message: jsonSafe(payload.message),
    },
    digest,
  };
}
