import { describe, expect, it, vi, beforeEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { InvoiceAttestation } from "../src/attest/signAttestation";
import { invoiceAttestationTypedData } from "../src/attest/signAttestation";

const resolveNextNonce = vi.fn();
vi.mock("../src/attest/nextNonce", () => ({ resolveNextNonce }));

const screenAddresses = vi.fn();
const defaultComplianceProvider = vi.fn(() => ({}));
vi.mock("../src/compliance", () => ({ screenAddresses, defaultComplianceProvider }));

const checkRateLimit = vi.fn();
vi.mock("../src/ratelimit/limiter", () => ({ checkRateLimit }));

const { preCheckAttestation } = await import("../src/attest/precheck");

const debtorAccount = privateKeyToAccount(generatePrivateKey());
const creditorAccount = privateKeyToAccount(generatePrivateKey());

const BASE_INVOICE: InvoiceAttestation = {
  invoiceRef: "0x1111111111111111111111111111111111111111111111111111111111111111",
  amount: 1_000_000n,
  currency: "0x3600000000000000000000000000000000000000",
  maturity: 1_792_588_650n,
  earlyNetConsent: true,
  debtor: debtorAccount.address,
  creditor: creditorAccount.address,
  nonce: 1n,
  registry: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312",
  chainId: 5042002n,
};

async function realSignatures(invoice: InvoiceAttestation) {
  const typedData = invoiceAttestationTypedData(invoice);
  return {
    debtorSignature: await debtorAccount.signTypedData(typedData),
    creditorSignature: await creditorAccount.signTypedData(typedData),
  };
}

describe("preCheckAttestation", () => {
  beforeEach(() => {
    resolveNextNonce.mockReset();
    screenAddresses.mockReset();
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, count: 1 });
    resolveNextNonce.mockResolvedValue(1n);
    screenAddresses.mockResolvedValue([
      { address: debtorAccount.address, status: "clear" },
      { address: creditorAccount.address, status: "clear" },
    ]);
  });

  it("passes for a genuinely signed, current, unflagged invoice", async () => {
    const { debtorSignature, creditorSignature } = await realSignatures(BASE_INVOICE);
    const result = await preCheckAttestation({ invoice: BASE_INVOICE, debtorSignature, creditorSignature, rateLimitKey: "0xsession" });
    expect(result).toEqual({ ok: true });
  });

  it("rejects when the debtor signature doesn't recover to the invoice's debtor", async () => {
    const otherAccount = privateKeyToAccount(generatePrivateKey());
    const typedData = invoiceAttestationTypedData(BASE_INVOICE);
    const wrongDebtorSignature = await otherAccount.signTypedData(typedData);
    const creditorSignature = await creditorAccount.signTypedData(typedData);

    const result = await preCheckAttestation({
      invoice: BASE_INVOICE,
      debtorSignature: wrongDebtorSignature,
      creditorSignature,
      rateLimitKey: "0xsession",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/debtor signature/i);
  });

  it("rejects a stale nonce", async () => {
    resolveNextNonce.mockResolvedValue(5n);
    const { debtorSignature, creditorSignature } = await realSignatures(BASE_INVOICE);
    const result = await preCheckAttestation({ invoice: BASE_INVOICE, debtorSignature, creditorSignature, rateLimitKey: "0xsession" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/nonce is stale/i);
  });

  it("rejects a compliance-flagged address", async () => {
    screenAddresses.mockResolvedValue([
      { address: debtorAccount.address, status: "flagged" },
      { address: creditorAccount.address, status: "clear" },
    ]);
    const { debtorSignature, creditorSignature } = await realSignatures(BASE_INVOICE);
    const result = await preCheckAttestation({ invoice: BASE_INVOICE, debtorSignature, creditorSignature, rateLimitKey: "0xsession" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/compliance/i);
  });

  it("rejects once the caller's rate limit is exceeded, before doing any other work", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, count: 11 });
    const { debtorSignature, creditorSignature } = await realSignatures(BASE_INVOICE);
    const result = await preCheckAttestation({ invoice: BASE_INVOICE, debtorSignature, creditorSignature, rateLimitKey: "0xsession" });
    expect(result.ok).toBe(false);
    expect(resolveNextNonce).not.toHaveBeenCalled();
  });
});
