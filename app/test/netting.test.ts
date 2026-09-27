import { describe, expect, it } from "vitest";
import { concatHex, hexToBigInt, keccak256, numberToHex, recoverAddress, size, sliceHex, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildCertificate,
  CertificateBuildError,
  entryHash,
  viewForParty,
  type LoopObligation,
} from "../src/netting/certificate";
import { commitment, isZeroHash, randomBlinding } from "../src/netting/commitment";
import { CurrencyError, formatAmount, isIsoCurrency, minorUnits, parseAmount } from "../src/netting/currency";
import { CertificateFormatError, parseCertificateView, serializeCertificateView } from "../src/netting/serialize";
import { recoverEcdsaSigner } from "../src/netting/signature";
import type { CertificateView, EntryDocument, LedgerDomain } from "../src/netting/types";
import { verifyCertificateView, type VerificationResult } from "../src/netting/verify";
import { signedCertificate, signedLoop } from "./helpers/netting";

const domain: LedgerDomain = { chainId: 5042002n, verifyingContract: "0x2F5996aaE68CbC8026543c405Cc81C26D58c2ef7" };
const NOW = 1_750_000_000n;

const statusOf = (result: VerificationResult, name: string) => result.checks.find((c) => c.name === name)?.status;

function fullDoc(view: CertificateView, i: number): EntryDocument {
  const entry = view.entries[i]!;
  if (entry.kind !== "full") throw new Error(`entry ${i} is not held in full`);
  return entry.document;
}

function withDoc(view: CertificateView, i: number, change: Partial<EntryDocument>): CertificateView {
  const entries = [...view.entries];
  entries[i] = { kind: "full", document: { ...fullDoc(view, i), ...change } };
  return { ...view, entries };
}

describe("currency", () => {
  it("reads minor units from Intl", () => {
    expect(minorUnits("USD")).toBe(2);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("KWD")).toBe(3);
  });

  it("round-trips parse and format", () => {
    expect(parseAmount("1250.00", "USD")).toBe(125_000n);
    expect(parseAmount("1250.5", "USD")).toBe(125_050n);
    expect(parseAmount("1250", "USD")).toBe(125_000n);
    expect(parseAmount("0.01", "USD")).toBe(1n);
    expect(parseAmount("1500", "JPY")).toBe(1500n);
    expect(parseAmount("1.234", "KWD")).toBe(1234n);
    for (const [amount, code] of [
      [125_000n, "USD"],
      [1n, "USD"],
      [0n, "USD"],
      [1500n, "JPY"],
      [1234n, "KWD"],
      [123_456_789_012_345_678_901_234_567_890n, "USD"],
    ] as const) {
      expect(parseAmount(formatAmount(amount, code), code)).toBe(amount);
    }
    expect(formatAmount(5n, "USD")).toBe("0.05");
  });

  it("rejects bad codes and bad amounts", () => {
    for (const code of ["usd", "US", "USDX", "XYZ", ""]) expect(isIsoCurrency(code)).toBe(false);
    expect(() => minorUnits("XYZ")).toThrow(CurrencyError);
    for (const input of ["-1", "1.234", "1,000", "1e3", "", ".5", "1.", "abc", "+1"]) {
      expect(() => parseAmount(input, "USD"), input).toThrow(CurrencyError);
    }
    expect(() => parseAmount("1.5", "JPY")).toThrow(CurrencyError);
  });
});

describe("randomBlinding", () => {
  it("returns distinct, non-zero 32-byte values", () => {
    const a = randomBlinding();
    const b = randomBlinding();
    expect(size(a)).toBe(32);
    expect(isZeroHash(a)).toBe(false);
    expect(a).not.toBe(b);
  });
});

describe("ECDSA acceptance rules match OpenZeppelin", () => {
  // secp256k1's order n, as in contracts/test/helpers/NettingSigningHelpers.sol.
  const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

  it("rejects the high-s twin of a valid signature, which raw ecrecover would accept", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const digest = keccak256(toHex("malleability"));
    const signature = await account.sign({ hash: digest });
    expect(await recoverEcdsaSigner(digest, signature)).toBe(account.address);

    const s = hexToBigInt(sliceHex(signature, 32, 64));
    const v = hexToBigInt(sliceHex(signature, 64, 65));
    const twin = concatHex([
      sliceHex(signature, 0, 32),
      numberToHex(CURVE_ORDER - s, { size: 32 }),
      numberToHex(v === 27n ? 28 : 27, { size: 1 }),
    ]);
    expect(await recoverAddress({ hash: digest, signature: twin })).toBe(account.address);
    expect(await recoverEcdsaSigner(digest, twin)).toBeNull();
  });

  it("rejects a bad v and a wrong length", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const digest = keccak256(toHex("v and length"));
    const signature = await account.sign({ hash: digest });
    const v = hexToBigInt(sliceHex(signature, 64, 65));
    expect(await recoverEcdsaSigner(digest, concatHex([sliceHex(signature, 0, 64), numberToHex(v - 27n, { size: 1 })]))).toBeNull();
    expect(await recoverEcdsaSigner(digest, sliceHex(signature, 0, 64))).toBeNull();
  });
});

describe("buildCertificate guards", () => {
  async function loopOf(amounts: bigint[]) {
    return (await signedLoop({ domain, amounts })).loop;
  }
  const build = (loop: LoopObligation[], overrides: { wNet?: bigint; currency?: string } = {}) =>
    buildCertificate({ domain, currency: overrides.currency ?? "USD", wNet: overrides.wNet ?? 100n, deadline: 4_000_000_000n, loop });

  it("builds a consistent certificate from a valid loop", async () => {
    const view = build(await loopOf([500n, 300n, 400n]), { wNet: 300n });
    expect(view.certificate.entries).toHaveLength(3);
    expect(view.signatures).toEqual([null, null, null]);
    for (let i = 0; i < 3; i++) {
      const doc = fullDoc(view, i);
      expect(doc.remainingAfter).toBe(doc.remainingBefore - 300n);
      expect(isZeroHash(view.certificate.entries[i]!.priorCommitment)).toBe(true);
    }
    expect(fullDoc(view, 1).remainingAfter).toBe(0n);
  });

  it("rejects a broken loop", async () => {
    const loop = await loopOf([100n, 100n, 100n]);
    expect(() => build([loop[0]!, loop[2]!, loop[1]!])).toThrow(CertificateBuildError);
  });

  it("rejects loops shorter than 2 or longer than 5", async () => {
    const single = (await loopOf([100n, 100n])).slice(0, 1);
    const six = await loopOf([100n, 100n, 100n, 100n, 100n, 100n]);
    expect(() => build(single)).toThrow(/2–5/);
    expect(() => build(six)).toThrow(/2–5/);
  });

  it("rejects a party who is debtor twice", async () => {
    const [a, b, c] = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
    const ab = (await signedLoop({ domain, amounts: [100n, 100n], parties: [a!, b!] })).loop;
    const ac = (await signedLoop({ domain, amounts: [100n, 100n], parties: [a!, c!] })).loop;
    // a→b, b→a, a→c, c→a closes as a path but has a as debtor twice.
    expect(() => build([ab[0]!, ab[1]!, ac[0]!, ac[1]!])).toThrow(/debtor twice/);
  });

  it("rejects mixed currencies", async () => {
    const loop = await loopOf([100n, 100n]);
    loop[1] = { ...loop[1]!, obligation: { ...loop[1]!.obligation, currency: "EUR" } };
    expect(() => build(loop)).toThrow(/EUR/);
    const usdLoop = await loopOf([100n, 100n]);
    expect(() => build(usdLoop, { currency: "XYZ" })).toThrow(/ISO 4217/);
  });

  it("rejects a wNet of zero or above any remaining", async () => {
    const loop = await loopOf([100n, 50n]);
    expect(() => build(loop, { wNet: 0n })).toThrow(/positive/);
    expect(() => build(loop, { wNet: 51n })).toThrow(/exceeds/);
  });

  it("rejects an inconsistent prior state", async () => {
    const loop = await loopOf([100n, 100n]);
    const neverNettedButReduced = [{ ...loop[0]!, remaining: 60n }, loop[1]!];
    expect(() => build(neverNettedButReduced, { wNet: 10n })).toThrow(/never netted/);
    const moreThanAmount = [{ ...loop[0]!, remaining: 101n, blinding: randomBlinding() }, loop[1]!];
    expect(() => build(moreThanAmount, { wNet: 10n })).toThrow(/more remaining/);
  });

  it("chains from a previously netted state", async () => {
    const loop = await loopOf([100n, 100n]);
    const blinding = randomBlinding();
    const view = build([{ ...loop[0]!, remaining: 40n, blinding }, { ...loop[1]!, remaining: 40n, blinding }], { wNet: 40n });
    const id = view.certificate.entries[0]!.obligationId;
    expect(view.certificate.entries[0]!.priorCommitment).toBe(commitment(id, 40n, blinding));
  });
});

describe("verifyCertificateView", () => {
  it("passes a fully signed certificate offline when every signer is an EOA", async () => {
    const { view } = await signedCertificate({ domain, amounts: [500n, 300n, 400n] });
    const result = await verifyCertificateView(view, { now: NOW });
    expect(result.checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(["certificate.loop", "certificate-signature:2", "entry:2:next-commitment", "content-hash"]),
    );
  });

  it("checks an unsigned certificate at the proposed stage, and requires signatures after", async () => {
    const { view } = await signedCertificate({ domain, amounts: [500n, 300n] });
    const unsigned = { ...view, signatures: [null, null] };
    expect((await verifyCertificateView(unsigned, { now: NOW, stage: "proposed" })).ok).toBe(true);
    const signedStage = await verifyCertificateView(unsigned, { now: NOW });
    expect(signedStage.ok).toBe(false);
    expect(statusOf(signedStage, "certificate-signature:0")).toBe("fail");
  });

  it("can't confirm the applied stage without a chain client", async () => {
    const { view } = await signedCertificate({ domain, amounts: [500n, 300n] });
    const result = await verifyCertificateView(view, { now: NOW, stage: "applied" });
    expect(statusOf(result, "onchain")).toBe("unverifiable");
    expect(result.ok).toBe(false);
  });

  describe("fails the specific check for each tampered field", () => {
    const cases: [string, (view: CertificateView) => CertificateView, string[]][] = [
      ["remainingAfter", (v) => withDoc(v, 1, { remainingAfter: fullDoc(v, 1).remainingAfter + 1n }), ["entry:1:amounts", "entry:1:next-commitment", "content-hash"]],
      ["remainingBefore", (v) => withDoc(v, 0, { remainingBefore: fullDoc(v, 0).remainingBefore - 1n }), ["entry:0:prior-commitment", "entry:0:amounts", "content-hash"]],
      ["blindingAfter", (v) => withDoc(v, 2, { blindingAfter: randomBlinding() }), ["entry:2:next-commitment", "content-hash"]],
      ["blindingBefore", (v) => withDoc(v, 0, { blindingBefore: randomBlinding() }), ["entry:0:prior-commitment", "content-hash"]],
      ["wNet", (v) => ({ ...v, wNet: v.wNet + 1n }), ["entry:0:amounts", "entry:1:amounts", "content-hash"]],
      ["currency", (v) => ({ ...v, currency: "EUR" }), ["entry:0:currency", "content-hash"]],
      [
        "path",
        (v) => {
          const entries = [...v.certificate.entries];
          entries[0] = { ...entries[0]!, creditor: privateKeyToAccount(generatePrivateKey()).address };
          return { ...v, certificate: { ...v.certificate, entries } };
        },
        ["certificate.loop", "entry:0:parties"],
      ],
      [
        "a swapped-in party",
        (v) => {
          const doc = fullDoc(v, 0);
          const stranger = privateKeyToAccount(generatePrivateKey()).address;
          return withDoc(v, 0, { obligation: { ...doc.obligation, debtor: stranger } });
        },
        ["entry:0:obligation-id", "entry:0:parties", "content-hash"],
      ],
      [
        "contentHash",
        (v) => ({ ...v, certificate: { ...v.certificate, contentHash: keccak256(toHex("other")) } }),
        ["content-hash"],
      ],
    ];

    for (const [label, tamper, expectedFailures] of cases) {
      it(label, async () => {
        const { view } = await signedCertificate({ domain, amounts: [500n, 300n, 400n] });
        const result = await verifyCertificateView(tamper(view), { now: NOW });
        expect(result.ok).toBe(false);
        for (const name of expectedFailures) expect(statusOf(result, name), name).toBe("fail");
      });
    }

    it("a hidden entry's hash", async () => {
      const { view, fixture } = await signedCertificate({ domain, amounts: [500n, 300n, 400n] });
      const partyView = viewForParty(view, fixture.parties[0]!.address);
      const hiddenIndex = partyView.entries.findIndex((e) => e.kind === "hash");
      const entries = [...partyView.entries];
      entries[hiddenIndex] = { kind: "hash", entryHash: keccak256(toHex("forged")) };
      const result = await verifyCertificateView({ ...partyView, entries }, { now: NOW });
      expect(statusOf(result, "content-hash")).toBe("fail");
      expect(result.ok).toBe(false);
    });

    it("maturity without early-net consent", async () => {
      const early = { domain, amounts: [500n, 300n], maturity: NOW + 86_400n };
      const noConsent = await signedCertificate({ ...early, earlyNetConsent: false });
      const result = await verifyCertificateView(noConsent.view, { now: NOW });
      expect(statusOf(result, "entry:0:maturity")).toBe("fail");
      expect(result.ok).toBe(false);

      const consent = await signedCertificate({ ...early, earlyNetConsent: true });
      expect((await verifyCertificateView(consent.view, { now: NOW })).ok).toBe(true);
    });
  });

  it("never passes a signature it can't check offline", async () => {
    const { view } = await signedCertificate({ domain, amounts: [500n, 300n] });
    const doc = fullDoc(view, 0);
    // Could be a smart account's ERC-1271 signature; only the chain can say.
    const swapped = withDoc(view, 0, { debtorSignature: doc.creditorSignature, creditorSignature: doc.debtorSignature });
    const result = await verifyCertificateView(swapped, { now: NOW });
    expect(statusOf(result, "entry:0:obligation-signatures")).toBe("unverifiable");
    expect(result.ok).toBe(false);

    const certSigs = await verifyCertificateView({ ...view, signatures: [view.signatures[1]!, view.signatures[0]!] }, { now: NOW });
    expect(statusOf(certSigs, "certificate-signature:0")).toBe("unverifiable");
    expect(certSigs.ok).toBe(false);
  });

  it("reports malformed input as a failed check instead of throwing", async () => {
    const { view } = await signedCertificate({ domain, amounts: [500n, 300n] });
    const entries = [...view.certificate.entries];
    entries[0] = { ...entries[0]!, obligationId: "0x12" };
    for (const bad of [
      { ...view, certificate: { ...view.certificate, entries } },
      { ...view, signatures: [view.signatures[0]!] },
      { ...view, wNet: 5 as unknown as bigint },
      null as unknown as CertificateView,
    ]) {
      const result = await verifyCertificateView(bad, { now: NOW });
      expect(result.ok).toBe(false);
      expect(statusOf(result, "view.shape")).toBe("fail");
    }
  });

  it("fails a view that holds no entry in full", async () => {
    const { view } = await signedCertificate({ domain, amounts: [500n, 300n] });
    const hashesOnly: CertificateView = {
      ...view,
      entries: view.entries.map((_, i) => ({ kind: "hash", entryHash: entryHash(fullDoc(view, i), domain) })),
    };
    const result = await verifyCertificateView(hashesOnly, { now: NOW });
    expect(statusOf(result, "content-hash")).toBe("pass");
    expect(statusOf(result, "view.coverage")).toBe("fail");
    expect(result.ok).toBe(false);
  });
});

describe("per-party views keep other parties' amounts private", () => {
  it("holds exactly the party's own two entries in full, verifies, and leaks nothing else", async () => {
    const amounts = [5_000_000n, 91_234_567n, 82_345_678n, 73_456_789n];
    const { view, fixture } = await signedCertificate({ domain, amounts });
    const party: Address = fixture.parties[1]!.address;
    const partyView = viewForParty(view, party);

    // Party 1 is creditor on entry 0 and debtor on entry 1.
    expect(partyView.entries.map((e) => e.kind)).toEqual(["full", "full", "hash", "hash"]);
    expect((await verifyCertificateView(partyView, { now: NOW })).ok).toBe(true);

    const json = serializeCertificateView(partyView);
    for (const i of [2, 3]) {
      const hidden = fullDoc(view, i);
      const secrets: (string | Hex)[] = [
        hidden.remainingBefore.toString(),
        hidden.remainingAfter.toString(),
        hidden.obligation.amount.toString(),
        hidden.blindingAfter,
        hidden.obligation.salt,
        hidden.obligation.documentHash,
        hidden.debtorSignature,
        hidden.creditorSignature,
      ];
      for (const secret of secrets) expect(json.toLowerCase().includes(secret.toLowerCase()), `entry ${i}: ${secret}`).toBe(false);
    }
  });

  it("refuses to make a view for someone outside the loop", async () => {
    const { view } = await signedCertificate({ domain, amounts: [500n, 300n] });
    expect(() => viewForParty(view, privateKeyToAccount(generatePrivateKey()).address)).toThrow(CertificateBuildError);
  });
});

describe("serialization", () => {
  it("round-trips a full view and a party view, both still verifying", async () => {
    const { view, fixture } = await signedCertificate({ domain, amounts: [500n, 300n, 400n] });
    for (const v of [view, viewForParty(view, fixture.parties[2]!.address)]) {
      const parsed = parseCertificateView(serializeCertificateView(v));
      expect(parsed).toEqual(v);
      expect((await verifyCertificateView(parsed, { now: NOW })).ok).toBe(true);
    }
  });

  it("rejects unknown versions and wrong types", async () => {
    const { view } = await signedCertificate({ domain, amounts: [500n, 300n] });
    const raw = JSON.parse(serializeCertificateView(view));
    expect(() => parseCertificateView(JSON.stringify({ ...raw, format: "contraflow-netting-certificate/2" }))).toThrow(
      CertificateFormatError,
    );
    expect(() => parseCertificateView(JSON.stringify({ ...raw, wNet: 300 }))).toThrow(/wNet/);
    expect(() => parseCertificateView(JSON.stringify({ ...raw, wNet: "-1" }))).toThrow(/wNet/);
    raw.entries[0].document.obligation.earlyNetConsent = "yes";
    expect(() => parseCertificateView(JSON.stringify(raw))).toThrow(/earlyNetConsent/);
    expect(() => parseCertificateView("not json")).toThrow(CertificateFormatError);
  });
});
