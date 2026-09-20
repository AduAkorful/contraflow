/// Server-only EIP-712 signing for `InvoiceAttestation`, per `00-architecture.md` §5: the app
/// signs both the debtor and creditor sides with operator-held burner keys, never a browser
/// wallet. This file must never be imported by client-bundled code.
///
/// The domain and type here must match `ContraflowRegistry.sol` exactly — `EIP712Upgradeable`'s
/// domain is `{name: "ContraflowRegistry", version: "1", chainId, verifyingContract: registry}`,
/// and `INVOICE_TYPEHASH`'s field order is mirrored field-for-field below. A mismatch here would
/// produce a signature `register()` rejects with `InvalidSignature`, not a silently-wrong one —
/// see `test/attest.integration.test.ts` for a real on-chain round-trip proving they agree.

import { hashTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface InvoiceAttestation {
  invoiceRef: Hex;
  amount: bigint;
  currency: Address;
  /// uint64 on-chain — kept as `bigint` here (not `number`) because viem's typed-data hashing
  /// requires an exact bigint for a `uintN` message field, not a JS number.
  maturity: bigint;
  earlyNetConsent: boolean;
  debtor: Address;
  creditor: Address;
  nonce: bigint;
  registry: Address;
  chainId: bigint;
}

const EIP712_DOMAIN_NAME = "ContraflowRegistry";
const EIP712_DOMAIN_VERSION = "1";

const INVOICE_ATTESTATION_TYPES = {
  InvoiceAttestation: [
    { name: "invoiceRef", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "currency", type: "address" },
    { name: "maturity", type: "uint64" },
    { name: "earlyNetConsent", type: "bool" },
    { name: "debtor", type: "address" },
    { name: "creditor", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "registry", type: "address" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

export function invoiceAttestationDomain(invoice: InvoiceAttestation) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: invoice.chainId,
    verifyingContract: invoice.registry,
  } as const;
}

export function invoiceAttestationTypedData(invoice: InvoiceAttestation) {
  return {
    domain: invoiceAttestationDomain(invoice),
    types: INVOICE_ATTESTATION_TYPES,
    primaryType: "InvoiceAttestation" as const,
    message: invoice,
  };
}

/// The exact digest `ContraflowRegistry._hashTypedDataV4(_hashInvoice(...))` computes on-chain —
/// also the invoice `id` `register()` returns/emits, so the app can address an invoice before
/// its `register()` tx has confirmed.
export function invoiceAttestationId(invoice: InvoiceAttestation): Hex {
  return hashTypedData(invoiceAttestationTypedData(invoice));
}

export interface AttestationSignatures {
  id: Hex;
  debtorSignature: Hex;
  creditorSignature: Hex;
}

export class SignerMismatchError extends Error {
  constructor(role: "debtor" | "creditor", expected: Address, actual: Address) {
    super(`signAttestation: ${role} key resolves to ${actual}, but invoice.${role} is ${expected}`);
    this.name = "SignerMismatchError";
  }
}

/// Signs the same `InvoiceAttestation` payload with both the debtor's and creditor's private
/// keys — `ContraflowRegistry.register` requires both signatures to recover to the struct's own
/// `debtor`/`creditor` fields. Throws `SignerMismatchError` early (before ever calling into the
/// chain) if a supplied key doesn't match the invoice's stated party — cheaper and clearer than
/// letting `register()` revert with `InvalidSignature` on-chain.
export async function signAttestation(
  invoice: InvoiceAttestation,
  debtorPrivateKey: Hex,
  creditorPrivateKey: Hex,
): Promise<AttestationSignatures> {
  const debtorAccount = privateKeyToAccount(debtorPrivateKey);
  const creditorAccount = privateKeyToAccount(creditorPrivateKey);

  if (debtorAccount.address.toLowerCase() !== invoice.debtor.toLowerCase()) {
    throw new SignerMismatchError("debtor", invoice.debtor, debtorAccount.address);
  }
  if (creditorAccount.address.toLowerCase() !== invoice.creditor.toLowerCase()) {
    throw new SignerMismatchError("creditor", invoice.creditor, creditorAccount.address);
  }

  const typedData = invoiceAttestationTypedData(invoice);
  const [debtorSignature, creditorSignature] = await Promise.all([
    debtorAccount.signTypedData(typedData),
    creditorAccount.signTypedData(typedData),
  ]);

  return { id: invoiceAttestationId(invoice), debtorSignature, creditorSignature };
}
