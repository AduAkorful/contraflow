/// Blinded state commitments: the only thing the ledger stores about an obligation.

import { bytesToHex, encodeAbiParameters, keccak256, type Hex } from "viem";
import { randomBytes } from "./random";

export const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

const BLINDING_BYTES = 32;

export function isZeroHash(value: Hex): boolean {
  return /^0x0{64}$/i.test(value);
}

/// `keccak256(abi.encode(obligationId, remaining, blinding))`. Without the blinding, anyone
/// could recover `remaining` by hashing guesses against the public commitment.
export function commitment(obligationId: Hex, remaining: bigint, blinding: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }],
      [obligationId, remaining, blinding],
    ),
  );
}

/// 32 bytes from the platform CSPRNG. Throws rather than falling back to anything weaker, since
/// a guessable blinding exposes the amount it hides. Never returns the zero hash, which means
/// "never netted" elsewhere in this module.
export function randomBlinding(): Hex {
  for (;;) {
    const blinding = bytesToHex(randomBytes(BLINDING_BYTES));
    if (!isZeroHash(blinding)) return blinding;
  }
}
