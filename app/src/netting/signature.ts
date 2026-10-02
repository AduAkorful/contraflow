/// Signature checks with the ledger's exact acceptance rules: ECDSA first (65 bytes, low-s,
/// v of 27 or 28, as OpenZeppelin's `ECDSA.tryRecoverCalldata`), then ERC-1271 for a signer
/// with code. Offline, a signature that isn't the signer's own ECDSA signature can't be ruled
/// in or out (the signer may be a smart account), so it's `unverifiable`, never `pass`.

import {
  hexToBigInt,
  encodeFunctionData,
  isAddressEqual,
  parseAbi,
  recoverAddress,
  size,
  sliceHex,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export type CheckStatus = "pass" | "fail" | "unverifiable";

export interface SignatureCheck {
  status: CheckStatus;
  detail: string;
}

/// The subset of a viem public client the verifier uses.
export type ChainReader = Pick<PublicClient, "getCode" | "readContract" | "call" | "getChainId" | "getLogs" | "getBlockNumber">;

const ECDSA_SIGNATURE_BYTES = 65;
// Half the secp256k1 order: OpenZeppelin rejects any `s` above it (malleable signatures).
const SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

const ERC1271_ABI = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);
const ERC1271_MAGIC_VALUE = toFunctionSelector("isValidSignature(bytes32,bytes)");

/// The address a signature recovers to under OpenZeppelin's rules, or `null` if it doesn't parse.
export async function recoverEcdsaSigner(digest: Hex, signature: Hex): Promise<Address | null> {
  if (size(signature) !== ECDSA_SIGNATURE_BYTES) return null;
  const s = hexToBigInt(sliceHex(signature, 32, 64));
  const v = hexToBigInt(sliceHex(signature, 64, 65));
  if (s > SECP256K1_HALF_ORDER || (v !== 27n && v !== 28n)) return null;
  try {
    return await recoverAddress({ hash: digest, signature });
  } catch {
    return null;
  }
}

export async function checkSignature(
  signer: Address,
  digest: Hex,
  signature: Hex,
  client?: ChainReader,
): Promise<SignatureCheck> {
  const recovered = await recoverEcdsaSigner(digest, signature);
  if (recovered && isAddressEqual(recovered, signer)) return { status: "pass", detail: `ECDSA signature from ${signer}` };

  if (!client) {
    return {
      status: "unverifiable",
      detail: `Not ${signer}'s own ECDSA signature; if ${signer} is a smart account, only the chain can check it`,
    };
  }

  const code = await client.getCode({ address: signer });
  if (!code || code === "0x") return { status: "fail", detail: `Not a valid signature from ${signer}` };

  try {
    const data = encodeFunctionData({
      abi: ERC1271_ABI,
      functionName: "isValidSignature",
      args: [digest, signature],
    });
    const result = await client.call({ to: signer, data });
    const raw = result.data;
    // Match OpenZeppelin's SignatureChecker: require at least one full ABI word and compare
    // the complete first word, so non-zero padding cannot be discarded by bytes4 decoding.
    const expectedWord = `${ERC1271_MAGIC_VALUE.slice(2)}${"0".repeat(56)}`;
    if (raw && size(raw) >= 32 && raw.slice(2, 66).toLowerCase() === expectedWord.toLowerCase()) {
      return { status: "pass", detail: `ERC-1271 signature from smart account ${signer}` };
    }
    return { status: "fail", detail: `Smart account ${signer} rejected the signature` };
  } catch {
    return { status: "fail", detail: `Smart account ${signer} rejected the signature` };
  }
}

/// Combines several checks: any failure fails, otherwise anything unverifiable is unverifiable.
export function combineStatuses(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("unverifiable")) return "unverifiable";
  return "pass";
}
