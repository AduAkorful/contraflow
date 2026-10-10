import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAttestLink, serializeAttestLink } from "../src/attest/link";
import type { InvoiceAttestation } from "../src/attest/signAttestation";
import { newShareToken } from "../src/share/shareToken";

const { insertInvoiceLink, getInvoiceLinkByToken } = vi.hoisted(() => ({
  insertInvoiceLink: vi.fn(),
  getInvoiceLinkByToken: vi.fn(),
}));

vi.mock("../src/db/invoiceLinks", () => ({ insertInvoiceLink, getInvoiceLinkByToken }));

import { createInvoiceShareLink, getInvoiceShareLink } from "../src/attest/invoiceLinks";

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

const encoded = encodeAttestLink({ invoice: INVOICE, role: "debtor", signatureA: "0xabc123" });
const token = newShareToken();

describe("createInvoiceShareLink", () => {
  beforeEach(() => {
    insertInvoiceLink.mockReset();
    getInvoiceLinkByToken.mockReset();
  });

  it("stores a v2 payload when the session is the signer", async () => {
    insertInvoiceLink.mockResolvedValueOnce(token);
    const result = await createInvoiceShareLink(INVOICE.debtor, encoded);
    expect(result).toEqual({ ok: true, token });
    expect(insertInvoiceLink).toHaveBeenCalledWith({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      payload: serializeAttestLink({ invoice: INVOICE, role: "debtor", signatureA: "0xabc123" }),
      debtor: INVOICE.debtor,
      creditor: INVOICE.creditor,
    });
  });

  it("rejects a session that isn't the signer", async () => {
    await expect(createInvoiceShareLink(INVOICE.creditor, encoded)).resolves.toEqual({
      ok: false,
      error: "Not found.",
    });
    expect(insertInvoiceLink).not.toHaveBeenCalled();
  });
});

describe("getInvoiceShareLink", () => {
  beforeEach(() => {
    getInvoiceLinkByToken.mockReset();
  });

  it("returns the payload to either party", async () => {
    const payload = serializeAttestLink({ invoice: INVOICE, role: "debtor", signatureA: "0xabc123" });
    getInvoiceLinkByToken.mockResolvedValue({
      token,
      payload,
      debtor: INVOICE.debtor.toLowerCase(),
      creditor: INVOICE.creditor.toLowerCase(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await expect(getInvoiceShareLink(INVOICE.creditor, token)).resolves.toEqual({ ok: true, payload });
    await expect(getInvoiceShareLink(INVOICE.debtor, token)).resolves.toEqual({ ok: true, payload });
  });

  it("answers Not found for a non-party, an expired row, or a bad token", async () => {
    const payload = serializeAttestLink({ invoice: INVOICE, role: "debtor", signatureA: "0xabc123" });
    getInvoiceLinkByToken.mockResolvedValue({
      token,
      payload,
      debtor: INVOICE.debtor.toLowerCase(),
      creditor: INVOICE.creditor.toLowerCase(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await expect(
      getInvoiceShareLink("0x0000000000000000000000000000000000000001", token),
    ).resolves.toEqual({ ok: false, error: "Not found." });

    getInvoiceLinkByToken.mockResolvedValue({
      token,
      payload,
      debtor: INVOICE.debtor.toLowerCase(),
      creditor: INVOICE.creditor.toLowerCase(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(getInvoiceShareLink(INVOICE.debtor, token)).resolves.toEqual({
      ok: false,
      error: "Not found.",
    });

    await expect(getInvoiceShareLink(INVOICE.debtor, "not-a-token")).resolves.toEqual({
      ok: false,
      error: "Not found.",
    });

    getInvoiceLinkByToken.mockResolvedValue(null);
    await expect(getInvoiceShareLink(INVOICE.debtor, token)).resolves.toEqual({
      ok: false,
      error: "Not found.",
    });
  });
});
