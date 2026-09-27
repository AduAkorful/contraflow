/// A stand-in for the netting ledger's chain in unit tests: `stateOf`, `isApplied` and receipts
/// with a real `CertificateApplied` log, and an `apply` that enforces the ledger's
/// compare-and-swap on prior commitments. Every signer is an EOA.

import { encodeAbiParameters, encodeEventTopics, keccak256, toHex, zeroAddress, type Hex } from "viem";
import { contraflowNettingLedgerAbi } from "../../src/contracts/abi/index";
import { ZERO_HASH } from "../../src/netting/commitment";
import { obligationKey } from "../../src/netting/obligation";
import type { CertificateView, LedgerDomain } from "../../src/netting/types";
import type { CertificateServiceDeps } from "../../src/obligations/certificates";

export function fakeLedgerChain(domain: LedgerDomain) {
  const states = new Map<string, Hex>();
  const applied = new Set<string>();
  const receipts = new Map<string, unknown>();
  let txCount = 0;

  const client = {
    getChainId: async () => Number(domain.chainId),
    getCode: async () => undefined,
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === "stateOf") return states.get((args[0] as Hex).toLowerCase()) ?? ZERO_HASH;
      if (functionName === "isApplied") return applied.has((args[0] as Hex).toLowerCase());
      throw new Error(`fakeLedgerChain: unexpected read ${functionName}`);
    },
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const receipt = receipts.get(hash.toLowerCase());
      if (!receipt) throw new Error("Transaction receipt not found");
      return receipt;
    },
  } as unknown as CertificateServiceDeps["client"];

  /// Applies a certificate as the ledger would, returning a transaction hash with a receipt.
  function apply(view: CertificateView, target: LedgerDomain["verifyingContract"] = domain.verifyingContract): Hex {
    const { certificate } = view;
    if (applied.has(certificate.certificateId.toLowerCase())) throw new Error("CertificateAlreadyApplied");
    for (const e of certificate.entries) {
      const key = obligationKey(e.obligationId, e.debtor, e.creditor).toLowerCase();
      if ((states.get(key) ?? ZERO_HASH) !== e.priorCommitment.toLowerCase()) throw new Error("StaleCommitment");
    }
    for (const e of certificate.entries) {
      states.set(obligationKey(e.obligationId, e.debtor, e.creditor).toLowerCase(), e.nextCommitment.toLowerCase() as Hex);
    }
    applied.add(certificate.certificateId.toLowerCase());
    return receiptWithEvent(certificate.certificateId, certificate.contentHash, target);
  }

  /// A successful transaction whose receipt carries a `CertificateApplied` log, without applying
  /// anything: for checking that each field of the event is compared.
  function receiptWithEvent(certificateId: Hex, contentHash: Hex, emitter: Hex = domain.verifyingContract): Hex {
    const hash = keccak256(toHex(`tx ${++txCount}`));
    receipts.set(hash, {
      status: "success",
      to: emitter,
      logs: [
        {
          address: emitter,
          topics: encodeEventTopics({
            abi: contraflowNettingLedgerAbi,
            eventName: "CertificateApplied",
            args: { certificateId, submitter: zeroAddress },
          }),
          data: encodeAbiParameters([{ type: "bytes32" }], [contentHash]),
        },
      ],
    });
    return hash;
  }

  /// A transaction that succeeded but applied nothing.
  function unrelatedTx(): Hex {
    const hash = keccak256(toHex(`tx ${++txCount}`));
    receipts.set(hash, { status: "success", to: domain.verifyingContract, logs: [] });
    return hash;
  }

  return { client, states, apply, receiptWithEvent, unrelatedTx };
}
