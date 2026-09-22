import { describe, expect, it } from "vitest";
import { encodeAttestLink, decodeAttestLink, MalformedAttestLinkError } from "../src/attest/link";
import type { InvoiceAttestation } from "../src/attest/signAttestation";

const INVOICE: InvoiceAttestation = {
  invoiceRef: "0x1111111111111111111111111111111111111111111111111111111111111111",
  amount: 1_050_000_000n,
  currency: "0x3600000000000000000000000000000000000000",
  maturity: 1_792_588_650n,
  earlyNetConsent: true,
  debtor: "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C",
  creditor: "0xD98CC80747e67B357EA914614C213209c877Be04",
  nonce: 1n,
  registry: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312",
  chainId: 5042002n,
};

describe("encodeAttestLink / decodeAttestLink", () => {
  it("round-trips an invoice, preserving bigint fields exactly", () => {
    const encoded = encodeAttestLink({ invoice: INVOICE, role: "debtor", signatureA: "0xabc123" });
    const decoded = decodeAttestLink(encoded);
    expect(decoded).toEqual({ invoice: INVOICE, role: "debtor", signatureA: "0xabc123" });
    expect(typeof decoded.invoice.amount).toBe("bigint");
    expect(typeof decoded.invoice.maturity).toBe("bigint");
    expect(typeof decoded.invoice.nonce).toBe("bigint");
    expect(typeof decoded.invoice.chainId).toBe("bigint");
  });

  it("produces a URL-safe string (no +, /, or = characters)", () => {
    const encoded = encodeAttestLink({ invoice: INVOICE, role: "creditor", signatureA: "0xdeadbeef" });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("throws MalformedAttestLinkError for garbage input", () => {
    expect(() => decodeAttestLink("not-valid-base64url-json")).toThrow(MalformedAttestLinkError);
  });

  it("throws MalformedAttestLinkError for a truncated/tampered link", () => {
    const encoded = encodeAttestLink({ invoice: INVOICE, role: "debtor", signatureA: "0xabc123" });
    expect(() => decodeAttestLink(encoded.slice(0, -10))).toThrow(MalformedAttestLinkError);
  });

  it("throws MalformedAttestLinkError when a numeric field isn't a valid decimal string", () => {
    // Simulate a payload where JSON parses fine but a bigint field is garbage.
    const badJson = JSON.stringify({
      invoice: { ...INVOICE, amount: "not-a-number", maturity: "1", nonce: "1", chainId: "1" },
      role: "debtor",
      signatureA: "0xabc123",
    });
    const bytes = new TextEncoder().encode(badJson);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(() => decodeAttestLink(encoded)).toThrow(MalformedAttestLinkError);
  });
});
