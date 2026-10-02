import { beforeEach, describe, expect, it } from "vitest";
import { getAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createPhase1ComplianceProvider } from "../src/compliance";
import { certificateTypedData } from "../src/netting/certificate";
import { commitment } from "../src/netting/commitment";
import { obligationKey } from "../src/netting/obligation";
import { parseCertificateView } from "../src/netting/serialize";
import type { CertificateView, LedgerDomain } from "../src/netting/types";
import { verifyCertificateView } from "../src/netting/verify";
import { CERTIFICATE_LIFETIME_SECONDS, createCertificateService, type CertificateService } from "../src/obligations/certificates";
import { fakeLedgerChain } from "./helpers/fakeLedgerChain";
import { createMemoryCertificateStore, seedObligation, type MemoryCertificateStore } from "./helpers/memoryCertificateStore";
import { signedLoop } from "./helpers/netting";

const domain: LedgerDomain = {
  chainId: 5042002n,
  verifyingContract: getAddress("0x00000000000000000000000000000000000c0ffe"),
};
const START = 1_800_000_000n;

let store: MemoryCertificateStore;
let chain: ReturnType<typeof fakeLedgerChain>;
let clock: bigint;
let denylist: Address[];
let limited: boolean;
let service: CertificateService;

beforeEach(() => {
  store = createMemoryCertificateStore();
  chain = fakeLedgerChain(domain);
  clock = START;
  denylist = [];
  limited = false;
  service = createCertificateService({
    store,
    client: chain.client,
    domain,
    now: () => clock,
    complianceProvider: { screenAddress: (a) => createPhase1ComplianceProvider(denylist).screenAddress(a) },
    rateLimited: async () => limited,
  });
});

/// A loop of signed obligations stored as step 3 would have left them.
async function seededLoop(amounts: bigint[], options: { currency?: string; parties?: PrivateKeyAccount[] } = {}) {
  const fixture = await signedLoop({ domain, amounts, currency: options.currency, parties: options.parties });
  const rows = fixture.loop.map((item) => seedObligation(store, domain, item));
  return { parties: fixture.parties, rows };
}

async function propose(session: Address): Promise<string> {
  const result = await service.findAndProposeLoop(session);
  if (!result.ok) throw new Error(result.error);
  if (!result.outcome.found) throw new Error(result.outcome.message);
  return result.outcome.token;
}

async function partyView(session: Address, token: string): Promise<CertificateView> {
  const result = await service.getCertificateView(session, token);
  if (!result.ok) throw new Error(result.error);
  return parseCertificateView(result.certificate.view);
}

async function signAll(token: string, parties: PrivateKeyAccount[]) {
  for (const p of parties) {
    const view = await partyView(p.address, token);
    const signature = await p.signTypedData(certificateTypedData(view.certificate, view.domain));
    expect(await service.submitCertificateSignature(p.address, token, signature)).toEqual({ ok: true });
  }
}

const certificateFor = (token: string) => [...store.certificates.values()].find((c) => c.token === token)!;
const locked = () => [...store.certificates.values()].flatMap((c) => c.entries.filter((e) => e.locked).map((e) => e.obligationId));

describe("finding and proposing a loop", () => {
  it("proposes the caller's loop, locks it, and shows each party only its own obligations", async () => {
    const { parties, rows } = await seededLoop([700_00n, 450_00n, 900_00n]);
    const result = await service.findAndProposeLoop(parties[0]!.address);
    expect(result.ok && result.outcome).toMatchObject({ found: true, currency: "USD", wNet: "45000", parties: 3 });
    const token = result.ok && result.outcome.found ? result.outcome.token : "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const stored = certificateFor(token);
    expect(stored.status).toBe("collecting");
    expect(BigInt(stored.deadline)).toBe(START + CERTIFICATE_LIFETIME_SECONDS);
    expect(new Set(locked())).toEqual(new Set(rows.map((r) => r.obligationId)));

    for (const p of parties) {
      const view = await partyView(p.address, token);
      const full = view.entries.filter((e) => e.kind === "full");
      expect(full).toHaveLength(2);
      for (const e of full) {
        const o = e.kind === "full" ? e.document.obligation : null;
        expect([o!.debtor, o!.creditor].map((a) => a.toLowerCase())).toContain(p.address.toLowerCase());
      }
      const checked = await verifyCertificateView(view, { now: clock, stage: "proposed", client: chain.client });
      expect(checked.checks.filter((c) => c.status !== "pass")).toEqual([]);
    }
  });

  it("says why when there's nothing to propose", async () => {
    const loner = privateKeyToAccount(generatePrivateKey()).address;
    expect(await service.findAndProposeLoop(loner)).toMatchObject({ ok: true, outcome: { found: false, reason: "no-candidates" } });

    const { parties } = await seededLoop([100n, 100n, 100n]);
    const outsider = privateKeyToAccount(generatePrivateKey());
    await seededLoop([5n, 5n], { parties: [outsider, parties[0]!] });
    const other = privateKeyToAccount(generatePrivateKey());
    const [chainRow] = (await seededLoop([5n, 5n], { parties: [other, outsider] })).rows;
    store.obligations.get(chainRow!.obligationId)!.status = "closed";
    expect(await service.findAndProposeLoop(other.address)).toMatchObject({ ok: true, outcome: { found: false, reason: "no-loop" } });
  });

  it("finds a caller loop even when the database has over 2,000 unrelated obligations", async () => {
    const { parties, rows } = await seededLoop([100n, 100n, 100n]);
    const template = rows[0]!;
    for (let i = 0; i < 2_001; i++) {
      const n = BigInt(i + 10_000);
      const fake = {
        ...template,
        obligationId: `0x${n.toString(16).padStart(64, "0")}`,
        debtor: getAddress(`0x${(n * 2n).toString(16).padStart(40, "0")}`),
        creditor: getAddress(`0x${(n * 2n + 1n).toString(16).padStart(40, "0")}`),
        amount: "1",
        remaining: "1",
      };
      store.obligations.set(fake.obligationId, fake);
    }

    const result = await service.findAndProposeLoop(parties[0]!.address);

    expect(result.ok && result.outcome).toMatchObject({ found: true, wNet: "100" });
  });

  it("reports an incomplete search when the caller-local query exceeds its row budget", async () => {
    const { parties, rows } = await seededLoop([100n, 100n, 100n]);
    const template = rows[0]!;
    for (let i = 0; i < 2_001; i++) {
      const n = BigInt(i + 20_000);
      const fake = {
        ...template,
        obligationId: `0x${n.toString(16).padStart(64, "0")}`,
        debtor: parties[0]!.address,
        creditor: getAddress(`0x${(n + 1n).toString(16).padStart(40, "0")}`),
        amount: "1",
        remaining: "1",
      };
      store.obligations.set(fake.obligationId, fake);
    }

    expect(await service.findAndProposeLoop(parties[0]!.address)).toMatchObject({
      ok: true,
      outcome: { found: false, reason: "search-incomplete" },
    });
    expect(store.certificates.size).toBe(0);
  });

  it("reports an incomplete search when the currency fanout exceeds its query budget", async () => {
    const { parties, rows } = await seededLoop([100n, 100n, 100n]);
    const template = rows[0]!;
    for (let i = 0; i < 130; i++) {
      const n = BigInt(i + 30_000);
      const fake = {
        ...template,
        obligationId: `0x${n.toString(16).padStart(64, "0")}`,
        debtor: parties[0]!.address,
        creditor: getAddress(`0x${(n + 1n).toString(16).padStart(40, "0")}`),
        currency: `TOKEN-${i}`,
        amount: "1",
        remaining: "1",
      };
      store.obligations.set(fake.obligationId, fake);
    }

    expect(await service.findAndProposeLoop(parties[0]!.address)).toMatchObject({
      ok: true,
      outcome: { found: false, reason: "search-incomplete" },
    });
    expect(store.certificates.size).toBe(0);
  });

  it("never offers a locked obligation again", async () => {
    const { parties } = await seededLoop([100n, 100n, 100n]);
    await propose(parties[0]!.address);
    expect(await service.findAndProposeLoop(parties[1]!.address)).toMatchObject({ ok: true, outcome: { found: false } });
  });

  it("gives the loser of two simultaneous proposals a plain retry message", async () => {
    const { parties } = await seededLoop([100n, 100n, 100n]);
    const [first, second] = await Promise.all([
      service.findAndProposeLoop(parties[0]!.address),
      service.findAndProposeLoop(parties[1]!.address),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok && r.outcome.found)).toHaveLength(1);
    expect(outcomes.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "One of these obligations was just included in another certificate. Try again." },
    ]);
    expect(store.certificates.size).toBe(1);
  });

  it("marks an obligation that disagrees with the ledger out of sync, and searches again without it", async () => {
    const { parties, rows } = await seededLoop([100n, 100n, 100n]);
    const spare = await seededLoop([30n, 30n], { parties: [parties[0]!, parties[1]!] });
    // The ledger has already moved one obligation of the three-party loop on.
    const drifted = rows[2]!;
    chain.states.set(obligationKey(drifted.obligationId as Hex, drifted.debtor as Address, drifted.creditor as Address), commitment(drifted.obligationId as Hex, 1n, `0x${"11".repeat(32)}`));

    const token = await propose(parties[0]!.address);
    expect(store.obligations.get(drifted.obligationId)!.status).toBe("out_of_sync");
    // Without it, the only loop left is between the first two parties.
    const stored = certificateFor(token);
    expect(stored.entries.map((e) => e.obligationId)).not.toContain(drifted.obligationId);
    expect(stored.entries).toHaveLength(2);
    expect(stored.entries.map((e) => e.obligationId)).toContain(spare.rows[1]!.obligationId);
  });

  it("refuses to build from a row whose terms no longer match its signatures", async () => {
    const { parties, rows } = await seededLoop([100n, 100n]);
    store.obligations.get(rows[0]!.obligationId)!.amount = "999";
    store.obligations.get(rows[0]!.obligationId)!.remaining = "999";
    expect(await service.findAndProposeLoop(parties[0]!.address)).toMatchObject({ ok: true, outcome: { found: false } });
    expect(store.certificates.size).toBe(0);
  });

  it("leaves out anyone the compliance screen flags", async () => {
    const { parties } = await seededLoop([100n, 100n, 100n]);
    denylist = [parties[2]!.address];
    expect(await service.findAndProposeLoop(parties[0]!.address)).toMatchObject({ ok: true, outcome: { found: false } });
  });

  it("refuses when rate-limited", async () => {
    limited = true;
    expect(await service.findAndProposeLoop(privateKeyToAccount(generatePrivateKey()).address)).toEqual({
      ok: false,
      error: "Too many requests. Try again shortly.",
    });
  });
});

describe("parties only", () => {
  it("answers 'Not found' to anyone else, everywhere, and for a made-up token", async () => {
    const { parties } = await seededLoop([100n, 100n, 100n]);
    const token = await propose(parties[0]!.address);
    const stranger = privateKeyToAccount(generatePrivateKey());
    const notFound = { ok: false, error: "Not found." };
    const signature = await stranger.signTypedData(certificateTypedData((await partyView(parties[0]!.address, token)).certificate, domain));

    expect(await service.getCertificateView(stranger.address, token)).toEqual(notFound);
    expect(await service.submitCertificateSignature(stranger.address, token, signature)).toEqual(notFound);
    expect(await service.declineCertificate(stranger.address, token)).toEqual(notFound);
    expect(await service.exportCertificate(stranger.address, token)).toEqual(notFound);
    expect(await service.recordApplicationTx(stranger.address, token, `0x${"ab".repeat(32)}`)).toEqual(notFound);
    expect(await service.getCertificateView(parties[0]!.address, "A".repeat(22))).toEqual(notFound);
    expect(await service.getCertificateView(parties[0]!.address, "../etc")).toEqual(notFound);
    expect(await service.closeObligation(stranger.address, [...store.obligations.keys()][0])).toEqual(notFound);
  });
});

describe("signatures", () => {
  it("refuses a signature that isn't the session's own over this certificate", async () => {
    const { parties } = await seededLoop([100n, 100n, 100n]);
    const token = await propose(parties[0]!.address);
    const view = await partyView(parties[0]!.address, token);
    const otherPartys = await parties[1]!.signTypedData(certificateTypedData(view.certificate, domain));
    const otherCert = await parties[0]!.signTypedData(
      certificateTypedData({ ...view.certificate, deadline: view.certificate.deadline + 1n }, domain),
    );
    const refused = { ok: false, error: "That signature isn't valid for this certificate." };
    expect(await service.submitCertificateSignature(parties[0]!.address, token, otherPartys)).toEqual(refused);
    expect(await service.submitCertificateSignature(parties[0]!.address, token, otherCert)).toEqual(refused);
    expect(await service.submitCertificateSignature(parties[0]!.address, token, "0x1234")).toEqual(refused);
    expect(await service.submitCertificateSignature(parties[0]!.address, token, "not hex")).toEqual({ ok: false, error: "Invalid signature." });
    expect(certificateFor(token).signatures).toEqual([]);
  });

  it("stores each party's signature against its own entry, idempotently, and becomes ready with the last", async () => {
    const { parties } = await seededLoop([100n, 100n, 100n]);
    const token = await propose(parties[0]!.address);
    const [first, ...rest] = parties;
    await signAll(token, [first!]);
    await signAll(token, [first!]);
    const stored = certificateFor(token);
    expect(stored.signatures).toHaveLength(1);
    expect(stored.entries[stored.signatures[0]!.idx]!.debtor).toBe(first!.address.toLowerCase());
    expect(stored.status).toBe("collecting");

    await signAll(token, rest);
    expect(certificateFor(token).status).toBe("ready");
    const summary = await service.getCertificateView(parties[1]!.address, token);
    expect(summary.ok && summary.certificate).toMatchObject({ status: "ready", signedCount: 3, parties: 3, youSigned: true });
  });

  it("won't take a signature after the deadline", async () => {
    const { parties } = await seededLoop([100n, 100n]);
    const token = await propose(parties[0]!.address);
    const view = await partyView(parties[0]!.address, token);
    clock = view.certificate.deadline;
    const signature = await parties[0]!.signTypedData(certificateTypedData(view.certificate, domain));
    expect(await service.submitCertificateSignature(parties[0]!.address, token, signature)).toEqual({
      ok: false,
      error: "This certificate has expired.",
    });
  });

  it("never reports a failed write as success", async () => {
    const { parties } = await seededLoop([100n, 100n]);
    const token = await propose(parties[0]!.address);
    const view = await partyView(parties[0]!.address, token);
    const signature = await parties[0]!.signTypedData(certificateTypedData(view.certificate, domain));
    store.failNextWrite();
    await expect(service.submitCertificateSignature(parties[0]!.address, token, signature)).rejects.toThrow(/fetch failed/);
    expect(certificateFor(token).signatures).toEqual([]);
  });
});

describe("declining, closing and expiry", () => {
  it("abandons on decline while collecting and releases the obligations", async () => {
    const { parties } = await seededLoop([100n, 100n, 100n]);
    const token = await propose(parties[0]!.address);
    expect(await service.declineCertificate(parties[2]!.address, token)).toEqual({ ok: true });
    expect(certificateFor(token).status).toBe("abandoned");
    expect(locked()).toEqual([]);
    expect(await service.declineCertificate(parties[2]!.address, token)).toEqual({ ok: true });
    await propose(parties[1]!.address);
  });

  it("can't be declined once everyone has signed", async () => {
    const { parties } = await seededLoop([100n, 100n]);
    const token = await propose(parties[0]!.address);
    await signAll(token, parties);
    expect(await service.declineCertificate(parties[0]!.address, token)).toMatchObject({ ok: false });
    expect(certificateFor(token).status).toBe("ready");
  });

  it("closing an obligation abandons a collecting certificate but is blocked by a signed one", async () => {
    const collecting = await seededLoop([100n, 100n]);
    const token1 = await propose(collecting.parties[0]!.address);
    const id1 = collecting.rows[0]!.obligationId;
    expect(await service.closeObligation(collecting.parties[1]!.address, id1)).toEqual({ ok: true });
    expect(certificateFor(token1).status).toBe("abandoned");
    expect(store.obligations.get(id1)!.status).toBe("closed");
    expect(await service.closeObligation(collecting.parties[0]!.address, id1)).toEqual({ ok: true });

    const signed = await seededLoop([100n, 100n]);
    const token2 = await propose(signed.parties[0]!.address);
    await signAll(token2, signed.parties);
    const id2 = signed.rows[1]!.obligationId;
    const blocked = await service.closeObligation(signed.parties[0]!.address, id2);
    expect(blocked).toMatchObject({ ok: false });
    expect(!blocked.ok && blocked.error).toMatch(/every party has signed/);
    expect(store.obligations.get(id2)!.status).toBe("active");

    chain.apply(await partyView(signed.parties[0]!.address, token2));
    await service.listCertificates(signed.parties[0]!.address);
    expect(await service.closeObligation(signed.parties[0]!.address, id2)).toEqual({ ok: true });
  });

  it("expires an unapplied certificate after its deadline and frees its obligations", async () => {
    const { parties } = await seededLoop([100n, 100n]);
    const token = await propose(parties[0]!.address);
    await signAll(token, parties);
    clock = START + CERTIFICATE_LIFETIME_SECONDS + 30n;
    await service.listCertificates(parties[0]!.address);
    expect(certificateFor(token).status).toBe("ready");

    clock = START + CERTIFICATE_LIFETIME_SECONDS + 2n * 60n * 60n;
    const listed = await service.listCertificates(parties[0]!.address);
    expect(listed.ok && listed.certificates[0]!.status).toBe("expired");
    expect(locked()).toEqual([]);
  });
});

describe("following the ledger", () => {
  it("advances obligations only after the ledger applies the certificate, then nets them again", async () => {
    const { parties, rows } = await seededLoop([700_00n, 450_00n, 900_00n]);
    const token = await propose(parties[0]!.address);
    await signAll(token, parties);
    const view = await partyView(parties[0]!.address, token);

    await service.listCertificates(parties[1]!.address);
    expect(store.obligations.get(rows[0]!.obligationId)!.remaining).toBe("70000");

    const txHash = chain.apply(view);
    expect(await service.recordApplicationTx(parties[2]!.address, token, txHash)).toEqual({ ok: true, status: "applied" });
    const stored = certificateFor(token);
    expect(stored.appliedTxHash).toBe(txHash);
    expect(locked()).toEqual([]);

    for (const [i, row] of rows.entries()) {
      const now = store.obligations.get(row.obligationId)!;
      expect(now.remaining).toBe(([700_00n, 450_00n, 900_00n][i]! - 450_00n).toString());
      const onchain = chain.states.get(obligationKey(row.obligationId as Hex, row.debtor as Address, row.creditor as Address).toLowerCase());
      expect(onchain).toBe(commitment(row.obligationId as Hex, BigInt(now.remaining), now.blinding as Hex));
    }

    // The fully netted obligation drops out; the other two can't form a loop alone.
    expect(store.obligations.get(rows[1]!.obligationId)!.remaining).toBe("0");
    expect(await service.findAndProposeLoop(parties[0]!.address)).toMatchObject({ ok: true, outcome: { found: false } });

    // A new obligation closes a smaller loop over the remaining amounts, from the new state.
    await seededLoop([100_00n, 100_00n], { parties: [parties[2]!, parties[0]!] });
    const token2 = await propose(parties[0]!.address);
    const second = certificateFor(token2);
    expect(second.entries.map((e) => e.obligationId)).toContain(rows[2]!.obligationId);
    await signAll(token2, [parties[0]!, parties[2]!]);
    chain.apply(await partyView(parties[0]!.address, token2));
    await service.listCertificates(parties[0]!.address);
    expect(certificateFor(token2).status).toBe("applied");
    expect(store.obligations.get(rows[2]!.obligationId)!.remaining).toBe((900_00n - 450_00n - 100_00n).toString());
  });

  it("picks up a certificate applied outside Contraflow, without its transaction hash", async () => {
    const { parties, rows } = await seededLoop([100n, 100n]);
    const token = await propose(parties[0]!.address);
    await signAll(token, parties);
    chain.apply(await partyView(parties[1]!.address, token));
    expect(await service.syncCertificate(certificateFor(token).certificateId as Hex)).toBe("applied");
    expect(store.obligations.get(rows[0]!.obligationId)!.remaining).toBe("0");
    expect(certificateFor(token).appliedTxHash).toBeNull();
  });

  it("never advances an obligation whose stored state changed underneath it", async () => {
    const { parties, rows } = await seededLoop([100n, 100n]);
    const token = await propose(parties[0]!.address);
    await signAll(token, parties);
    chain.apply(await partyView(parties[0]!.address, token));
    store.obligations.get(rows[0]!.obligationId)!.remaining = "77";
    await service.listCertificates(parties[0]!.address);
    expect(store.obligations.get(rows[0]!.obligationId)!.remaining).toBe("77");
    expect(store.obligations.get(rows[1]!.obligationId)!.remaining).toBe("0");
  });

  it("marks an obligation out of sync when the ledger has moved past the certificate", async () => {
    const { parties, rows } = await seededLoop([100n, 100n]);
    const token = await propose(parties[0]!.address);
    await signAll(token, parties);
    chain.apply(await partyView(parties[0]!.address, token));
    const r = rows[0]!;
    chain.states.set(obligationKey(r.obligationId as Hex, r.debtor as Address, r.creditor as Address).toLowerCase(), `0x${"22".repeat(32)}`);
    await service.listCertificates(parties[0]!.address);
    expect(store.obligations.get(r.obligationId)!.status).toBe("out_of_sync");
    expect(store.obligations.get(rows[1]!.obligationId)!.remaining).toBe("0");
    expect(certificateFor(token).status).toBe("applied");
  });

  it("changes nothing when the application transaction didn't apply this certificate", async () => {
    const { parties } = await seededLoop([100n, 100n]);
    const token = await propose(parties[0]!.address);
    await signAll(token, parties);
    const view = await partyView(parties[0]!.address, token);
    const wrong = { ok: false, error: "That transaction didn't apply this certificate." };
    expect(await service.recordApplicationTx(parties[0]!.address, token, chain.unrelatedTx())).toEqual(wrong);
    expect(await service.recordApplicationTx(parties[0]!.address, token, `0x${"cd".repeat(32)}`)).toEqual({
      ok: false,
      error: "That transaction isn't confirmed yet.",
    });
    const elsewhere = chain.apply(view, getAddress("0x000000000000000000000000000000000000dead"));
    expect(await service.recordApplicationTx(parties[0]!.address, token, elsewhere)).toEqual(wrong);

    // A real application, but of a different certificate.
    const other = await seededLoop([5n, 5n]);
    const otherToken = await propose(other.parties[0]!.address);
    await signAll(otherToken, other.parties);
    const otherTx = chain.apply(await partyView(other.parties[0]!.address, otherToken));
    expect(await service.recordApplicationTx(parties[0]!.address, token, otherTx)).toEqual(wrong);

    // Events that match this certificate in one field only.
    const { certificateId, contentHash } = view.certificate;
    const otherHash = `0x${"ee".repeat(32)}` as Hex;
    for (const forged of [chain.receiptWithEvent(certificateId, otherHash), chain.receiptWithEvent(otherHash, contentHash)]) {
      expect(await service.recordApplicationTx(parties[0]!.address, token, forged)).toEqual(wrong);
    }
    expect(certificateFor(token).appliedTxHash).toBeNull();
  });
});

describe("export", () => {
  it("is only available once signed, and verifies against the ledger once applied", async () => {
    const { parties } = await seededLoop([100n, 60n, 80n]);
    const token = await propose(parties[0]!.address);
    expect(await service.exportCertificate(parties[0]!.address, token)).toMatchObject({ ok: false });
    await signAll(token, parties);
    chain.apply(await partyView(parties[0]!.address, token));

    for (const p of parties) {
      const exported = await service.exportCertificate(p.address, token);
      if (!exported.ok) throw new Error(exported.error);
      const view = parseCertificateView(exported.json);
      expect(view.signatures.every((s) => s !== null)).toBe(true);
      expect(view.entries.filter((e) => e.kind === "full")).toHaveLength(2);
      const result = await verifyCertificateView(view, { now: clock, stage: "applied", client: chain.client });
      expect(result.checks.filter((c) => c.status !== "pass")).toEqual([]);
      const substituted = {
        ...view,
        certificate: { ...view.certificate, contentHash: `0x${"ee".repeat(32)}` as Hex },
      };
      const substitutedResult = await verifyCertificateView(substituted, { now: clock, stage: "applied", client: chain.client });
      expect(substitutedResult.checks.find((c) => c.name === "onchain:application-event")?.status).toBe("fail");
    }
  });
});
