/// The ledger's EIP-712 domain and types. These must match `ContraflowNettingLedger.sol` exactly:
/// its domain is `{name: "ContraflowNettingLedger", version: "1", chainId, verifyingContract}`
/// and the field order below mirrors its type strings. The known-vector test pins both.

import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import type { LedgerDomain } from "./types";

export const LEDGER_DOMAIN_NAME = "ContraflowNettingLedger";
export const LEDGER_DOMAIN_VERSION = "1";

/// Mirrors the ledger's `MIN_CYCLE_LENGTH`/`MAX_CYCLE_LENGTH`.
export const MIN_LOOP_LENGTH = 2;
export const MAX_LOOP_LENGTH = 5;

export function ledgerEip712Domain(domain: LedgerDomain) {
  return {
    name: LEDGER_DOMAIN_NAME,
    version: LEDGER_DOMAIN_VERSION,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract,
  } as const;
}

export const NETTING_OBLIGATION_TYPES = {
  NettingObligation: [
    { name: "documentHash", type: "bytes32" },
    { name: "debtor", type: "address" },
    { name: "creditor", type: "address" },
    { name: "currency", type: "string" },
    { name: "amount", type: "uint256" },
    { name: "maturity", type: "uint64" },
    { name: "earlyNetConsent", type: "bool" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export const NETTING_CERTIFICATE_TYPES = {
  NettingCertificate: [
    { name: "certificateId", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "entries", type: "CertificateEntry[]" },
  ],
  CertificateEntry: [
    { name: "obligationId", type: "bytes32" },
    { name: "debtor", type: "address" },
    { name: "creditor", type: "address" },
    { name: "priorCommitment", type: "bytes32" },
    { name: "nextCommitment", type: "bytes32" },
  ],
} as const;

/// The one ledger this app creates obligations for. Testnet-only, like the rest of `/app`, until
/// the mainnet chain switch.
export function appLedgerDomain(): LedgerDomain {
  return {
    chainId: BigInt(ARC_TESTNET_CHAIN_ID),
    verifyingContract: addressesForChain(ARC_TESTNET_CHAIN_ID).nettingLedger,
  };
}

/// The wallet-facing chain ID of a ledger domain (the app's own ledger by default).
export function ledgerChainId(domain: LedgerDomain = appLedgerDomain()): number {
  return Number(domain.chainId);
}
