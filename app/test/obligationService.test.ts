import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { randomBlinding } from "../src/netting/commitment";
import { appLedgerDomain } from "../src/netting/domain";
import { obligationFromDocument, OBLIGATION_DOCUMENT_FORMAT, type CanonicalObligationDocument } from "../src/netting/document";
import { obligationId, obligationTypedData } from "../src/netting/obligation";
import { serializeObligation } from "../src/netting/serialize";

// An in-memory stand-in for src/db/obligations.ts with the same semantics the SQL has: unique
// obligation ids, the (pair, document) uniqueness rule, and status transitions only from open or
// active.
const db = vi.hoisted(() => {
  class DuplicateObligationError extends Error {}
  const proposals = new Map<string, Record<string, unknown>>();
  const obligations = new Map<string, Record<string, unknown>>();
  const state = { failNextWrite: false };
  return { DuplicateObligationError, proposals, obligations, state };
});

vi.mock("../src/db/obligations", () => ({
  DuplicateObligationError: db.DuplicateObligationError,
  insertProposal: vi.fn(async (input: Record<string, unknown>) => {
    const existing = [...db.proposals.values()].find((p) => p.obligationId === input.obligationId);
    if (existing) return existing.token;
    db.proposals.set(input.token as string, {
      ...input,
      proposer: (input.proposer as string).toLowerCase(),
      counterparty: (input.counterparty as string).toLowerCase(),
      obligation: JSON.parse(JSON.stringify(input.obligation)),
      document: JSON.parse(JSON.stringify(input.document)),
      status: "open",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    });
    return input.token;
  }),
  getProposalByToken: vi.fn(async (token: string) => db.proposals.get(token) ?? null),
  obligationExistsForDocument: vi.fn(async (p: Record<string, string>) =>
    [...db.obligations.values()].some(
      (o) => o.debtor === p.debtor!.toLowerCase() && o.creditor === p.creditor!.toLowerCase() && o.documentHash === p.documentHash,
    ),
  ),
  acceptProposalWithObligation: vi.fn(async (token: string, input: Record<string, unknown>) => {
    if (db.state.failNextWrite) {
      db.state.failNextWrite = false;
      throw new Error("Error connecting to database: fetch failed");
    }
    const id = input.obligationId as string;
    const duplicate = [...db.obligations.values()].some(
      (o) => o.obligationId !== id && o.debtor === (input.debtor as string).toLowerCase() && o.documentHash === input.documentHash,
    );
    if (duplicate) throw new db.DuplicateObligationError("This document is already recorded as an obligation between these two parties.");
    if (!db.obligations.has(id)) {
      db.obligations.set(id, {
        ...input,
        debtor: (input.debtor as string).toLowerCase(),
        creditor: (input.creditor as string).toLowerCase(),
        amount: String(input.amount),
        remaining: String(input.amount),
        maturity: String(input.maturity),
        status: "active",
      });
    }
    const proposal = db.proposals.get(token);
    if (proposal?.status === "open") proposal.status = "accepted";
  }),
  markProposalWithdrawn: vi.fn(async (token: string) => {
    const proposal = db.proposals.get(token);
    if (proposal?.status === "open") proposal.status = "withdrawn";
  }),
  getObligationById: vi.fn(async (id: string) => db.obligations.get(id) ?? null),
  listObligationsForParty: vi.fn(async (a: string) =>
    [...db.obligations.values()].filter((o) => o.debtor === a.toLowerCase() || o.creditor === a.toLowerCase()),
  ),
  listOpenProposalsForParty: vi.fn(async (a: string) =>
    [...db.proposals.values()].filter(
      (p) => (p.proposer === a.toLowerCase() || p.counterparty === a.toLowerCase()) && p.status === "open",
    ),
  ),
}));

const limiter = vi.hoisted(() => ({ allowed: true }));
vi.mock("../src/ratelimit/limiter", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: limiter.allowed, remaining: 0, count: 0 })),
}));

// Every signer in these tests is an EOA.
vi.mock("../src/chain/client", () => ({
  createArcPublicClient: () => ({ getCode: async () => undefined, readContract: async () => "0x", getChainId: async () => 5042002 }),
}));

const service = await import("../src/obligations/service");
const domain = appLedgerDomain();

async function proposeFixture(proposerRole: "debtor" | "creditor" = "creditor", description = "Consulting, September") {
  const debtor = privateKeyToAccount(generatePrivateKey());
  const creditor = privateKeyToAccount(generatePrivateKey());
  const document: CanonicalObligationDocument = {
    format: OBLIGATION_DOCUMENT_FORMAT,
    description,
    debtor: debtor.address,
    creditor: creditor.address,
    currency: "USD",
    amount: "980.50",
    maturity: "2026-12-31",
    earlyNetConsent: false,
  };
  const obligation = obligationFromDocument(document, randomBlinding());
  const sign = (a: PrivateKeyAccount) => a.signTypedData(obligationTypedData(obligation, domain));
  const proposer = proposerRole === "debtor" ? debtor : creditor;
  const counterparty = proposerRole === "debtor" ? creditor : debtor;
  const created = await service.createProposal(proposer.address, {
    obligation: serializeObligation(obligation),
    document,
    proposerRole,
    proposerSignature: await sign(proposer),
  });
  if (!created.ok) throw new Error(created.error);
  return { debtor, creditor, proposer, counterparty, document, obligation, sign, token: created.token };
}

beforeEach(() => {
  db.proposals.clear();
  db.obligations.clear();
  db.state.failNextWrite = false;
  limiter.allowed = true;
});

describe("obligation proposals", () => {
  it("round-trips: propose, counterparty views and accepts, both parties see the obligation", async () => {
    const f = await proposeFixture();
    expect(f.token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const view = await service.getProposal(f.counterparty.address, f.token);
    expect(view.ok && view.proposal.viewerRole).toBe("counterparty");
    expect(view.ok && view.proposal.state).toBe("open");

    expect(await service.acceptProposal(f.counterparty.address, f.token, await f.sign(f.counterparty))).toEqual({ ok: true });

    for (const party of [f.debtor, f.creditor]) {
      const list = await service.listMine(party.address);
      expect(list.ok && list.obligations).toHaveLength(1);
      expect(list.ok && list.proposals).toHaveLength(0);
    }
    const stored = db.obligations.get(obligationId(f.obligation, domain))!;
    expect(stored.debtorSignature).toBeDefined();
    expect(stored.blinding).toMatch(/^0x0{64}$/);
  });

  it("returns the same token when the same proposal is submitted twice", async () => {
    const f = await proposeFixture();
    const again = await service.createProposal(f.proposer.address, {
      obligation: serializeObligation(f.obligation),
      document: f.document,
      proposerRole: "creditor",
      proposerSignature: await f.sign(f.proposer),
    });
    expect(again).toEqual({ ok: true, token: f.token });
  });

  it("shows nothing to anyone who isn't a party, and the same answer for a made-up token", async () => {
    const f = await proposeFixture();
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    expect(await service.getProposal(stranger, f.token)).toEqual({ ok: false, error: "Not found." });
    expect(await service.getProposal(f.counterparty.address, "AAAAAAAAAAAAAAAAAAAAAA")).toEqual({ ok: false, error: "Not found." });
    expect(await service.getProposal(f.counterparty.address, "../etc/passwd")).toEqual({ ok: false, error: "Not found." });
    expect(await service.acceptProposal(stranger, f.token, "0x12")).toEqual({ ok: false, error: "Not found." });
    expect(await service.withdrawProposal(stranger, f.token)).toEqual({ ok: false, error: "Not found." });
  });

  it("refuses to let the proposer accept their own proposal", async () => {
    const f = await proposeFixture();
    const result = await service.acceptProposal(f.proposer.address, f.token, await f.sign(f.counterparty));
    expect(result.ok).toBe(false);
    expect(db.obligations.size).toBe(0);
  });

  it("is idempotent when accepted twice", async () => {
    const f = await proposeFixture();
    const signature = await f.sign(f.counterparty);
    expect(await service.acceptProposal(f.counterparty.address, f.token, signature)).toEqual({ ok: true });
    expect(await service.acceptProposal(f.counterparty.address, f.token, signature)).toEqual({ ok: true });
    expect(db.obligations.size).toBe(1);
  });

  it("can't accept a withdrawn or expired proposal", async () => {
    const withdrawn = await proposeFixture();
    expect(await service.withdrawProposal(withdrawn.proposer.address, withdrawn.token)).toEqual({ ok: true });
    const afterWithdraw = await service.acceptProposal(withdrawn.counterparty.address, withdrawn.token, await withdrawn.sign(withdrawn.counterparty));
    expect(afterWithdraw).toEqual({ ok: false, error: "This proposal was withdrawn." });

    const expired = await proposeFixture();
    db.proposals.get(expired.token)!.expiresAt = new Date(Date.now() - 1000);
    const view = await service.getProposal(expired.counterparty.address, expired.token);
    expect(view.ok && view.proposal.state).toBe("expired");
    const afterExpiry = await service.acceptProposal(expired.counterparty.address, expired.token, await expired.sign(expired.counterparty));
    expect(afterExpiry.ok).toBe(false);
    expect(db.obligations.size).toBe(0);
  });

  it("lets the counterparty decline", async () => {
    const f = await proposeFixture();
    expect(await service.withdrawProposal(f.counterparty.address, f.token)).toEqual({ ok: true });
    const view = await service.getProposal(f.proposer.address, f.token);
    expect(view.ok && view.proposal.state).toBe("withdrawn");
  });

  it("rejects stored terms that were altered after the proposal was made", async () => {
    const f = await proposeFixture();
    (db.proposals.get(f.token)!.document as Record<string, unknown>).amount = "9800.50";
    const result = await service.acceptProposal(f.counterparty.address, f.token, await f.sign(f.counterparty));
    expect(result).toEqual({ ok: false, error: "The obligation doesn't match its document." });
    expect(db.obligations.size).toBe(0);
  });

  it("won't record the same document twice for a pair", async () => {
    const f = await proposeFixture();
    await service.acceptProposal(f.counterparty.address, f.token, await f.sign(f.counterparty));
    const again = await service.createProposal(f.proposer.address, {
      obligation: serializeObligation(obligationFromDocument(f.document, randomBlinding())),
      document: f.document,
      proposerRole: "creditor",
      proposerSignature: await f.proposer.signTypedData(
        obligationTypedData(obligationFromDocument(f.document, randomBlinding()), domain),
      ),
    });
    expect(again.ok).toBe(false);
  });

  it("never reports a failed write as success", async () => {
    const f = await proposeFixture();
    db.state.failNextWrite = true;
    await expect(service.acceptProposal(f.counterparty.address, f.token, await f.sign(f.counterparty))).rejects.toThrow(
      /fetch failed/,
    );
    expect(db.obligations.size).toBe(0);
  });

  it("refuses when rate-limited", async () => {
    const f = await proposeFixture();
    limiter.allowed = false;
    expect(await service.acceptProposal(f.counterparty.address, f.token, await f.sign(f.counterparty))).toEqual({
      ok: false,
      error: "Too many requests. Try again shortly.",
    });
  });

  it("rejects malformed input without throwing", async () => {
    const me = privateKeyToAccount(generatePrivateKey()).address;
    for (const input of [
      { obligation: null, document: {}, proposerRole: "creditor", proposerSignature: "0x12" },
      { obligation: {}, document: {}, proposerRole: "creditor", proposerSignature: "0x12" },
    ]) {
      expect((await service.createProposal(me, input)).ok).toBe(false);
    }
    const f = await proposeFixture();
    const serialized = serializeObligation(f.obligation);
    expect(
      (await service.createProposal(f.proposer.address, { obligation: serialized, document: f.document, proposerRole: "boss", proposerSignature: "0x12" })).ok,
    ).toBe(false);
  });
});

describe("listMine", () => {
  it("scopes to the session address only", async () => {
    const mine = await proposeFixture();
    await proposeFixture();
    const list = await service.listMine(mine.proposer.address);
    expect(list.ok && list.proposals.map((p) => p.token)).toEqual([mine.token]);
    expect(list.ok && list.proposals[0]!.waitingOn).toBe("them");
    const theirs = await service.listMine(mine.counterparty.address);
    expect(theirs.ok && theirs.proposals[0]!.waitingOn).toBe("you");
  });
});
