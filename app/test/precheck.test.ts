import { describe, expect, it, vi, beforeEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { InvoiceAttestation } from "../src/attest/signAttestation";
import { invoiceAttestationTypedData } from "../src/attest/signAttestation";
import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";

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
  registry: addressesForChain(ARC_TESTNET_CHAIN_ID).registry,
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

  it.each([
    { name: "zero amount", changes: { amount: 0n }, reason: /positive uint256/i },
    { name: "foreign Registry", changes: { registry: "0x0000000000000000000000000000000000000001" as `0x${string}` }, reason: /different Registry/i },
    { name: "foreign asset", changes: { currency: "0x0000000000000000000000000000000000000001" as `0x${string}` }, reason: /configured USDC/i },
    { name: "foreign chain", changes: { chainId: 5042n }, reason: /different chain/i },
    { name: "self invoice", changes: { creditor: debtorAccount.address }, reason: /different addresses/i },
  ])("rejects $name before nonce lookup and screening", async ({ changes, reason }) => {
    const invoice = { ...BASE_INVOICE, ...changes } as InvoiceAttestation;
    const { debtorSignature, creditorSignature } = await realSignatures(invoice);
    const result = await preCheckAttestation({
      invoice,
      debtorSignature,
      creditorSignature,
      rateLimitKey: "0xsession",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
    expect(resolveNextNonce).not.toHaveBeenCalled();
    expect(screenAddresses).not.toHaveBeenCalled();
  });

  it("fails closed when its rate limiter is unavailable", async () => {
    checkRateLimit.mockRejectedValueOnce(new Error("upstash down"));
    const { debtorSignature, creditorSignature } = await realSignatures(BASE_INVOICE);
    await expect(preCheckAttestation({
      invoice: BASE_INVOICE,
      debtorSignature,
      creditorSignature,
      rateLimitKey: "0xsession",
    })).resolves.toEqual({ ok: false, reason: "Pre-check is temporarily unavailable." });
    expect(resolveNextNonce).not.toHaveBeenCalled();
  });
});
