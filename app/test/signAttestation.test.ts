import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, recoverTypedDataAddress, toHex } from "viem";
import {
  invoiceAttestationId,
  invoiceAttestationTypedData,
  signAttestation,
  SignerMismatchError,
  type InvoiceAttestation,
} from "../src/attest/signAttestation";

function sampleInvoice(overrides: Partial<InvoiceAttestation> = {}): InvoiceAttestation {
  const debtorKey = generatePrivateKey();
  const creditorKey = generatePrivateKey();
  const debtor = privateKeyToAccount(debtorKey).address;
  const creditor = privateKeyToAccount(creditorKey).address;
  return {
    invoiceRef: keccak256(toHex("sample-invoice-ref")),
    amount: 1_000_000_000n,
    currency: "0x3600000000000000000000000000000000000000",
    maturity: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
    earlyNetConsent: true,
    debtor,
    creditor,
    nonce: 1n,
    registry: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312",
    chainId: 5042002n,
    ...overrides,
  };
}

describe("signAttestation", () => {
  it("produces signatures that recover to the invoice's own debtor/creditor addresses", async () => {
    const debtorKey = generatePrivateKey();
    const creditorKey = generatePrivateKey();
    const invoice = sampleInvoice({
      debtor: privateKeyToAccount(debtorKey).address,
      creditor: privateKeyToAccount(creditorKey).address,
    });

    const { debtorSignature, creditorSignature, id } = await signAttestation(invoice, debtorKey, creditorKey);

    const typedData = invoiceAttestationTypedData(invoice);
    const recoveredDebtor = await recoverTypedDataAddress({ ...typedData, signature: debtorSignature });
    const recoveredCreditor = await recoverTypedDataAddress({ ...typedData, signature: creditorSignature });

    expect(recoveredDebtor.toLowerCase()).toBe(invoice.debtor.toLowerCase());
    expect(recoveredCreditor.toLowerCase()).toBe(invoice.creditor.toLowerCase());
    expect(id).toBe(invoiceAttestationId(invoice));
  });

  it("throws SignerMismatchError when the debtor key doesn't match invoice.debtor", async () => {
    const wrongKey = generatePrivateKey();
    const creditorKey = generatePrivateKey();
    const invoice = sampleInvoice({ creditor: privateKeyToAccount(creditorKey).address });

    await expect(signAttestation(invoice, wrongKey, creditorKey)).rejects.toBeInstanceOf(SignerMismatchError);
  });

  it("throws SignerMismatchError when the creditor key doesn't match invoice.creditor", async () => {
    const debtorKey = generatePrivateKey();
    const wrongKey = generatePrivateKey();
    const invoice = sampleInvoice({ debtor: privateKeyToAccount(debtorKey).address });

    await expect(signAttestation(invoice, debtorKey, wrongKey)).rejects.toBeInstanceOf(SignerMismatchError);
  });

  it("invoiceAttestationId is a pure, deterministic function of the invoice fields", () => {
    const invoice = sampleInvoice({ nonce: 7n });
    expect(invoiceAttestationId(invoice)).toBe(invoiceAttestationId({ ...invoice }));
    expect(invoiceAttestationId(invoice)).not.toBe(invoiceAttestationId({ ...invoice, nonce: 8n }));
  });
});
