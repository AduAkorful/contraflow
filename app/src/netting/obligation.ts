/// Obligation hashing, identical to `ContraflowNettingLedger.obligationId`/`obligationKey`.

import { encodeAbiParameters, hashTypedData, keccak256, type Address, type Hex } from "viem";
import { ledgerEip712Domain, NETTING_OBLIGATION_TYPES } from "./domain";
import type { LedgerDomain, NettingObligation } from "./types";

/// What both parties sign to create an obligation.
export function obligationTypedData(obligation: NettingObligation, domain: LedgerDomain) {
  return {
    domain: ledgerEip712Domain(domain),
    types: NETTING_OBLIGATION_TYPES,
    primaryType: "NettingObligation" as const,
    message: obligation,
  };
}

/// The obligation's EIP-712 digest, which is also its id everywhere.
export function obligationId(obligation: NettingObligation, domain: LedgerDomain): Hex {
  return hashTypedData(obligationTypedData(obligation, domain));
}

/// The ledger's storage key: `keccak256(abi.encode(obligationId, debtor, creditor))`.
export function obligationKey(id: Hex, debtor: Address, creditor: Address): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }], [id, debtor, creditor]),
  );
}
