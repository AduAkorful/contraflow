/// The fixed values from `contracts/test/NettingLedgerKnownVectors.t.sol`, recomputed here in
/// TypeScript. Both sides must agree byte for byte; if either file's constants change, the other
/// must change with it.

import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, numberToHex, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { certificateDigest, certificateTypedData } from "../src/netting/certificate";
import { commitment, ZERO_HASH } from "../src/netting/commitment";
import { obligationId, obligationKey } from "../src/netting/obligation";
import type { LedgerDomain, NettingCertificate, NettingObligation } from "../src/netting/types";

const LEDGER: Address = "0x2e234DAe75C793f67A35089C9d99245E1C58470b";
const OBLIGATION_ID = "0x8e6ba142d646c71edd39397542dde23b09a1e11f4f9012920b2ad3a6dfa4087e";
const OBLIGATION_KEY = "0x75a80c709265704c21b219f34bb2dec65f5810218b8515a5df8c774a631e9e0c";
const FIRST_COMMITMENT = "0x2c75fc6537b4d6a30984df2b3571c8780cd950add59d89bbda3d0d28003412e2";
const CERTIFICATE_DIGEST = "0x0d231d77cddd83d5d2dbbc7359744abb2afd1f620a045849876bd04a9d815ad8";
const ALICE_SIGNATURE =
  "0xa902dd5c2d8c19f576b1825cb7bb44a60c2282d434f2998566e2eb5a2ac1760c23985d08dd4c0592092181f567a027f7611029060431d4373188e234abf799c41c";

const domain: LedgerDomain = { chainId: 31337n, verifyingContract: LEDGER };

// Private keys 0xA11CE, 0xB0B and 0xCA401, as `vm.addr` takes them.
const key = (n: number): Hex => numberToHex(n, { size: 32 });
const alice = privateKeyToAccount(key(0xa11ce));
const bob = privateKeyToAccount(key(0xb0b));
const carol = privateKeyToAccount(key(0xca401));

const obligation: NettingObligation = {
  documentHash: keccak256(toHex("INV-1042: consulting, September 2026")),
  debtor: alice.address,
  creditor: bob.address,
  currency: "USD",
  amount: 125_000n,
  maturity: 1_800_000_000n,
  earlyNetConsent: true,
  salt: keccak256(toHex("salt-1042")),
};

function fixtureCertificate(): NettingCertificate {
  const parties = [alice.address, bob.address, carol.address];
  return {
    certificateId: keccak256(toHex("certificate-1")),
    contentHash: keccak256(toHex("certificate-1 document")),
    deadline: 1_800_000_000n,
    entries: [0, 1, 2].map((i) => {
      const id = keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["obligation", BigInt(i)]));
      const blinding = keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["blinding", BigInt(i)]));
      return {
        obligationId: id,
        debtor: parties[i]!,
        creditor: parties[(i + 1) % 3]!,
        priorCommitment: ZERO_HASH,
        nextCommitment: commitment(id, 25_000n * BigInt(i + 1), blinding),
      };
    }),
  };
}

describe("netting known vectors (shared with the Solidity tests)", () => {
  it("obligationId matches the contract", () => {
    expect(obligationId(obligation, domain)).toBe(OBLIGATION_ID);
  });

  it("obligationKey matches the contract", () => {
    expect(obligationKey(OBLIGATION_ID, obligation.debtor, obligation.creditor)).toBe(OBLIGATION_KEY);
  });

  it("commitment matches the contract", () => {
    expect(fixtureCertificate().entries[0]!.nextCommitment).toBe(FIRST_COMMITMENT);
  });

  it("certificateDigest matches the contract", () => {
    expect(certificateDigest(fixtureCertificate(), domain)).toBe(CERTIFICATE_DIGEST);
  });

  it("viem signs the certificate to the exact same bytes as forge", async () => {
    const signature = await alice.signTypedData(certificateTypedData(fixtureCertificate(), domain));
    expect(signature).toBe(ALICE_SIGNATURE);
  });
});
