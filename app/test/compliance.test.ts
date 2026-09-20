import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { InvoiceEdge } from "@contraflow/solver";

import {
  StubClearProvider,
  ManualDenylistProvider,
  createPhase1ComplianceProvider,
  filterFlaggedInvoices,
} from "../src/compliance";
import { registerInvoice, ComplianceRejectedError } from "../src/actions/register";
import type { InvoiceAttestation } from "../src/attest/signAttestation";
import type { PublicClient, WalletClient } from "viem";

function freshAddress() {
  return privateKeyToAccount(generatePrivateKey()).address;
}

describe("StubClearProvider", () => {
  it("always clears, for any address", async () => {
    const result = await new StubClearProvider().screenAddress(freshAddress());
    expect(result.status).toBe("clear");
    expect(result.provider).toBe("stub");
  });
});

describe("ManualDenylistProvider", () => {
  it("flags exactly the addresses it was constructed with, case-insensitively", async () => {
    const denylisted = freshAddress();
    const clear = freshAddress();
    const provider = new ManualDenylistProvider([{ address: denylisted, reason: "test entry" }]);

    const flaggedResult = await provider.screenAddress(denylisted.toLowerCase() as typeof denylisted);
    expect(flaggedResult.status).toBe("flagged");
    expect(flaggedResult.reason).toBe("test entry");

    const clearResult = await provider.screenAddress(clear);
    expect(clearResult.status).toBe("clear");
  });
});

describe("createPhase1ComplianceProvider", () => {
  it("prefers the denylist result over the stub's unconditional clear", async () => {
    const denylisted = freshAddress();
    const clear = freshAddress();
    const provider = createPhase1ComplianceProvider([denylisted]);

    expect((await provider.screenAddress(denylisted)).status).toBe("flagged");
    expect((await provider.screenAddress(clear)).status).toBe("clear");
  });
});

describe("filterFlaggedInvoices", () => {
  it("drops any invoice touching a flagged address and keeps the rest", async () => {
    const a = freshAddress();
    const b = freshAddress();
    const flagged = freshAddress();
    const provider = createPhase1ComplianceProvider([flagged]);

    const invoices: InvoiceEdge[] = [
      { id: "0x1", debtor: a, creditor: b, amountRemaining: 1_000_000n },
      { id: "0x2", debtor: b, creditor: flagged, amountRemaining: 1_000_000n },
      { id: "0x3", debtor: flagged, creditor: a, amountRemaining: 1_000_000n },
    ];

    const { clearInvoices, flagged: flaggedResults } = await filterFlaggedInvoices(invoices, provider);

    expect(clearInvoices).toEqual([invoices[0]]);
    expect(flaggedResults).toHaveLength(1);
    expect(flaggedResults[0]?.address.toLowerCase()).toBe(flagged.toLowerCase());
  });
});

describe("registerInvoice compliance rejection", () => {
  it("throws ComplianceRejectedError before ever calling writeContract, when the debtor is flagged", async () => {
    const debtor = freshAddress();
    const creditor = freshAddress();
    const provider = createPhase1ComplianceProvider([debtor]);

    const writeContract = () => {
      throw new Error("writeContract should never be called for a flagged invoice");
    };
    const walletClient = { account: { address: creditor }, writeContract } as unknown as WalletClient;
    const publicClient = {} as PublicClient;

    const invoice: InvoiceAttestation = {
      invoiceRef: "0x0000000000000000000000000000000000000000000000000000000000000001",
      amount: 1_000_000n,
      currency: "0x3600000000000000000000000000000000000000",
      maturity: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
      earlyNetConsent: true,
      debtor,
      creditor,
      nonce: 1n,
      registry: "0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312",
      chainId: 5042002n,
    };

    await expect(
      registerInvoice({
        publicClient,
        signer: { kind: "raw-key", walletClient },
        registry: invoice.registry,
        invoice,
        debtorSignature: "0x00",
        creditorSignature: "0x00",
        complianceProvider: provider,
      }),
    ).rejects.toThrow(ComplianceRejectedError);
  });
});
