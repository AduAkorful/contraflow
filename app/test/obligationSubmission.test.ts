import { describe, expect, it } from "vitest";
import { keccak256, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createPhase1ComplianceProvider } from "../src/compliance";
import { randomBlinding, ZERO_HASH } from "../src/netting/commitment";
import { appLedgerDomain } from "../src/netting/domain";
import { obligationFromDocument, OBLIGATION_DOCUMENT_FORMAT, type CanonicalObligationDocument } from "../src/netting/document";
import { obligationTypedData } from "../src/netting/obligation";
import type { ChainReader } from "../src/netting/signature";
import type { NettingObligation } from "../src/netting/types";
import { validateAcceptance, validateProposal, type ProposerRole, type SubmissionDeps } from "../src/obligations/submission";

const domain = appLedgerDomain();

/// A chain where every address is an EOA, except `smartAccounts`, which answer ERC-1271 with the
/// given verdict.
function chain(smartAccounts: Record<string, boolean> = {}): ChainReader {
  const verdicts = new Map(Object.entries(smartAccounts).map(([a, v]) => [a.toLowerCase(), v]));
  return {
    getChainId: async () => Number(domain.chainId),
    getCode: async ({ address }: { address: Address }) => (verdicts.has(address.toLowerCase()) ? "0x6001" : undefined),
    call: async ({ to }: { to?: Address }) => ({
      data: verdicts.get(to?.toLowerCase() ?? "")
        ? `${toFunctionSelector("isValidSignature(bytes32,bytes)")}${"0".repeat(56)}` as Hex
        : `0x${"ff".repeat(32)}` as Hex,
    }),
  } as unknown as ChainReader;
}

function deps(overrides: Partial<SubmissionDeps> & { denylist?: Address[] } = {}): SubmissionDeps {
  return {
    client: overrides.client ?? chain(),
    complianceProvider: overrides.complianceProvider ?? createPhase1ComplianceProvider(overrides.denylist ?? []),
  };
}

async function fixture(proposerRole: ProposerRole = "creditor") {
  const debtor = privateKeyToAccount(generatePrivateKey());
  const creditor = privateKeyToAccount(generatePrivateKey());
  const document: CanonicalObligationDocument = {
    format: OBLIGATION_DOCUMENT_FORMAT,
    description: "Consulting, September",
    debtor: debtor.address,
    creditor: creditor.address,
    currency: "GHS",
    amount: "15000.00",
    maturity: "2026-12-31",
    earlyNetConsent: true,
  };
  const obligation = obligationFromDocument(document, randomBlinding());
  const sign = (account: PrivateKeyAccount, o: NettingObligation = obligation) =>
    account.signTypedData(obligationTypedData(o, domain));
  const proposer = proposerRole === "debtor" ? debtor : creditor;
  const counterparty = proposerRole === "debtor" ? creditor : debtor;
  return {
    debtor,
    creditor,
    proposer,
    counterparty,
    document,
    obligation,
    sign,
    proposal: {
      domain,
      obligation,
      document,
      proposerRole,
      proposerSignature: await sign(proposer),
      sessionAddress: proposer.address,
    },
  };
}

describe("validateProposal", () => {
  it("accepts a valid proposal from either side", async () => {
    for (const role of ["debtor", "creditor"] as const) {
      const f = await fixture(role);
      expect(await validateProposal(f.proposal, deps())).toEqual({ ok: true });
    }
  });

  it("fails each check with its own reason", async () => {
    const f = await fixture();
    const stranger = privateKeyToAccount(generatePrivateKey());
    const cases: [string, Parameters<typeof validateProposal>[0], RegExp][] = [
      ["wrong session", { ...f.proposal, sessionAddress: f.counterparty.address }, /party to/],
      ["stranger session", { ...f.proposal, sessionAddress: stranger.address }, /party to/],
      ["other chain", { ...f.proposal, domain: { ...domain, chainId: 5042n } }, /different ledger/],
      ["other ledger", { ...f.proposal, domain: { ...domain, verifyingContract: stranger.address } }, /different ledger/],
      ["zero salt", { ...f.proposal, obligation: { ...f.obligation, salt: ZERO_HASH } }, /salt/],
      ["bad currency", { ...f.proposal, document: { ...f.document, currency: "XYZ" } }, /ISO 4217/],
      ["amount mismatch", { ...f.proposal, obligation: { ...f.obligation, amount: f.obligation.amount + 1n } }, /match its document/],
      ["maturity mismatch", { ...f.proposal, obligation: { ...f.obligation, maturity: f.obligation.maturity + 1n } }, /match its document/],
      ["document edited", { ...f.proposal, document: { ...f.document, description: "Something else" } }, /match its document/],
      ["signature by someone else", { ...f.proposal, proposerSignature: await f.sign(stranger) }, /Invalid signature/],
      ["garbage signature", { ...f.proposal, proposerSignature: "0x1234" as Hex }, /Invalid signature/],
    ];
    for (const [label, input, reason] of cases) {
      const result = await validateProposal(input, deps());
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.reason, label).toMatch(reason);
    }
  });

  it("blocks a denylisted party", async () => {
    const f = await fixture();
    const result = await validateProposal(f.proposal, deps({ denylist: [f.counterparty.address] }));
    expect(result).toEqual({ ok: false, reason: "Blocked by compliance screening" });
  });

  it("accepts a smart account's signature only when the chain approves it", async () => {
    const f = await fixture();
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    const document = { ...f.document, creditor: wallet };
    const obligation = obligationFromDocument(document, randomBlinding());
    const input = { ...f.proposal, document, obligation, proposerSignature: "0xabcdef" as Hex, sessionAddress: wallet };

    expect(await validateProposal(input, deps({ client: chain({ [wallet]: true }) }))).toEqual({ ok: true });
    expect((await validateProposal(input, deps({ client: chain({ [wallet]: false }) }))).ok).toBe(false);
    expect((await validateProposal(input, deps({ client: chain() }))).ok).toBe(false);
  });
});

describe("a missing chain client", () => {
  it("never lets an offline 'unverifiable' signature through", async () => {
    const f = await fixture();
    const wallet = privateKeyToAccount(generatePrivateKey()).address;
    const document = { ...f.document, creditor: wallet };
    const obligation = obligationFromDocument(document, randomBlinding());
    const input = { ...f.proposal, document, obligation, proposerSignature: "0xabcdef" as Hex, sessionAddress: wallet };
    const noClient = { ...deps(), client: undefined as unknown as ChainReader };
    expect(await validateProposal(input, noClient)).toEqual({ ok: false, reason: `Invalid signature from ${wallet}` });
  });
});

describe("validateAcceptance", () => {
  it("accepts the counterparty's signature over the stored proposal", async () => {
    const f = await fixture("debtor");
    const result = await validateAcceptance(
      { ...f.proposal, sessionAddress: f.counterparty.address, counterpartySignature: await f.sign(f.counterparty) },
      deps(),
    );
    expect(result).toEqual({ ok: true });
  });

  it("refuses the proposer accepting their own proposal", async () => {
    const f = await fixture();
    const result = await validateAcceptance(
      { ...f.proposal, sessionAddress: f.proposer.address, counterpartySignature: await f.sign(f.counterparty) },
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "Only the counterparty can accept this obligation" });
  });

  it("re-checks the stored proposer signature and the new one", async () => {
    const f = await fixture();
    const counterpartySignature = await f.sign(f.counterparty);
    const base = { ...f.proposal, sessionAddress: f.counterparty.address, counterpartySignature };

    const forgedStored = await validateAcceptance({ ...base, proposerSignature: await f.sign(f.counterparty) }, deps());
    expect(forgedStored.ok).toBe(false);

    const otherTerms = { ...f.obligation, salt: keccak256(toHex("different salt")) };
    const signedOther = await validateAcceptance({ ...base, counterpartySignature: await f.sign(f.counterparty, otherTerms) }, deps());
    expect(signedOther.ok).toBe(false);
  });

  it("re-validates the stored terms as if they were new", async () => {
    const f = await fixture();
    const result = await validateAcceptance(
      {
        ...f.proposal,
        document: { ...f.document, amount: "15000.01" },
        sessionAddress: f.counterparty.address,
        counterpartySignature: await f.sign(f.counterparty),
      },
      deps(),
    );
    expect(result).toEqual({ ok: false, reason: "The obligation doesn't match its document" });
  });
});
