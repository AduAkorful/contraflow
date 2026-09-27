import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { ApiCaller } from "../src/api/auth";
import * as handlers from "../src/api/handlers";
import type { ApiDeps, ApiRequest } from "../src/api/handlers";
import { jsonSafe } from "../src/api/http";
import { SCOPE, permissionTypedData } from "../src/api/permissions";
import { contraflowNettingLedgerAbi } from "../src/contracts/abi/index";
import { serializeCertificateView, serializeObligation } from "../src/netting/serialize";
import type { LedgerDomain } from "../src/netting/types";
import type { ChainReader } from "../src/netting/signature";
import { signedCertificate, signedLoop } from "./helpers/netting";
import { memoryTenantStore } from "./helpers/memoryTenantStore";

const TESTNET = 5042002;
const TENANT: Hex = `0x${"ab".repeat(32)}`;
const NOW = 1_800_000_000n;
const domain: LedgerDomain = { chainId: BigInt(TESTNET), verifyingContract: "0x2F5996aaE68CbC8026543c405Cc81C26D58c2ef7" };
const caller: ApiCaller = { tenantId: TENANT, mode: "test", chainId: TESTNET };
const party = privateKeyToAccount(generatePrivateKey()).address;

const eoaChain = { getCode: async () => undefined, readContract: async () => "0x", getChainId: async () => TESTNET } as unknown as ChainReader;

function req(partial: Partial<ApiRequest> = {}): ApiRequest {
  return { params: {}, query: new URLSearchParams(), body: null, ...partial };
}

function deps(overrides: Partial<ApiDeps> = {}) {
  const store = memoryTenantStore();
  const obligations = {
    createProposal: vi.fn(async () => ({ ok: true as const, token: "tok123" })),
    getProposal: vi.fn(),
    acceptProposal: vi.fn(async () => ({ ok: true as const })),
    withdrawProposal: vi.fn(async () => ({ ok: true as const })),
    listMine: vi.fn(async () => ({ ok: true as const, proposals: [], obligations: [] })),
  };
  const certificates = {
    listCertificates: vi.fn(async () => ({ ok: true as const, certificates: [] })),
    findAndProposeLoop: vi.fn(async () => ({ ok: true as const, outcome: { kind: "none" } })),
    getCertificateView: vi.fn(),
    submitCertificateSignature: vi.fn(async () => ({ ok: true as const })),
    recordApplicationTx: vi.fn(async () => ({ ok: true as const, status: "applied" })),
    exportCertificate: vi.fn(async () => ({ ok: true as const, json: '{"format":"x"}', fileName: "c.json" })),
  };
  const d = {
    store,
    client: eoaChain,
    domain,
    nowSeconds: () => NOW,
    newId: () => "perm-1",
    obligations,
    certificates,
    tagProposal: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ApiDeps;
  return { d, store, obligations, certificates };
}

async function grant(store: ReturnType<typeof memoryTenantStore>, scopes: number, who: Address = party) {
  await store.savePermission({
    permissionId: `p-${scopes}-${who}`,
    tenantId: TENANT,
    chainId: TESTNET,
    party: who,
    scopes,
    expiresAt: NOW + 1000n,
    nonce: `0x${"0".repeat(63)}${scopes}`,
    signature: "0x",
  });
}

describe("permissions endpoints", () => {
  it("stores a party-signed permission once, then rejects the same nonce", async () => {
    const { d } = deps();
    const account = privateKeyToAccount(generatePrivateKey());
    const permission = { party: account.address, tenantId: TENANT, scopes: SCOPE.read, expiresAt: NOW + 60n, nonce: `0x${"11".repeat(32)}` as Hex };
    const signature = await account.signTypedData(permissionTypedData(TESTNET, permission));
    const body = { permission: { ...permission, expiresAt: permission.expiresAt.toString() }, signature };

    const first = await handlers.createPermission(caller, req({ body }), d);
    expect(first).toMatchObject({ status: 201, body: { permissionId: "perm-1", party: account.address, scopes: SCOPE.read } });
    await expect(handlers.createPermission(caller, req({ body }), d)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a permission not signed by its party", async () => {
    const { d } = deps();
    const permission = { party, tenantId: TENANT, scopes: SCOPE.read, expiresAt: (NOW + 60n).toString(), nonce: `0x${"22".repeat(32)}` };
    await expect(handlers.createPermission(caller, req({ body: { permission, signature: "0x1234" } }), d)).rejects.toMatchObject({
      status: 422,
    });
  });

  it("revokes only the caller's own permission", async () => {
    const { d, store } = deps();
    await grant(store, SCOPE.read);
    await expect(handlers.revokePermission(caller, req({ params: { permissionId: "nope" } }), d)).rejects.toMatchObject({ status: 404 });
    await expect(
      handlers.revokePermission({ ...caller, tenantId: `0x${"cd".repeat(32)}` }, req({ params: { permissionId: `p-1-${party}` } }), d),
    ).rejects.toMatchObject({ status: 404 });
    expect(await handlers.revokePermission(caller, req({ params: { permissionId: `p-1-${party}` } }), d)).toEqual({ status: 204, body: null });
  });
});

describe("scope enforcement", () => {
  const cases: [string, (d: ApiDeps) => Promise<unknown>, keyof typeof SCOPE][] = [
    ["list obligations", (d) => handlers.listPartyObligations(caller, req({ params: { address: party } }), d), "read"],
    ["find a loop", (d) => handlers.findLoop(caller, req({ params: { address: party } }), d), "propose"],
    ["accept a proposal", (d) => handlers.acceptObligationProposal(caller, req({ params: { token: "t" }, body: { party, signature: "0x" } }), d), "deliverSignatures"],
    ["sign a certificate", (d) => handlers.signCertificate(caller, req({ params: { token: "t" }, body: { party, signature: "0x" } }), d), "deliverSignatures"],
    ["export a certificate", (d) => handlers.exportCertificate(caller, req({ params: { token: "t" }, query: new URLSearchParams({ party }) }), d), "read"],
  ];

  for (const [name, call, scope] of cases) {
    it(`${name} needs the ${scope} scope, and answers Not found without it`, async () => {
      const { d, store } = deps();
      await expect(call(d)).rejects.toMatchObject({ status: 404, code: "not_found" });
      const others = (Object.keys(SCOPE) as (keyof typeof SCOPE)[]).filter((s) => s !== scope).reduce((a, s) => a | SCOPE[s], 0);
      await grant(store, others);
      await expect(call(d)).rejects.toMatchObject({ status: 404 });
      await grant(store, SCOPE[scope]);
      await expect(call(d)).resolves.toMatchObject({ status: expect.any(Number) });
    });
  }

  it("refuses a caller on a network with no ledger for obligations", async () => {
    const { d, store } = deps();
    await grant(store, SCOPE.read);
    await expect(handlers.listPartyObligations({ ...caller, chainId: 5042 }, req({ params: { address: party } }), d)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("calls the service as the party, never as the tenant", async () => {
    const { d, store, certificates } = deps();
    await grant(store, SCOPE.deliverSignatures);
    await handlers.signCertificate(caller, req({ params: { token: "tok" }, body: { party: party.toLowerCase(), signature: "0xabc" } }), d);
    expect(certificates.submitCertificateSignature).toHaveBeenCalledWith(party, "tok", "0xabc");
  });

  it("maps service answers to HTTP: Not found 404, rate limits 429, refusals 422", async () => {
    for (const [error, status] of [["Not found.", 404], ["Too many requests. Try again shortly.", 429], ["Invalid signature.", 422]] as const) {
      const { d, store, obligations } = deps();
      await grant(store, SCOPE.deliverSignatures);
      obligations.acceptProposal.mockResolvedValueOnce({ ok: false, error } as never);
      await expect(
        handlers.acceptObligationProposal(caller, req({ params: { token: "t" }, body: { party, signature: "0x" } }), d),
      ).rejects.toMatchObject({ status });
    }
  });
});

describe("proposals", () => {
  it("creates as the proposer, tags the tenant and returns the payload the counterparty signs", async () => {
    const { loop } = await signedLoop({ domain, amounts: [100n, 100n] });
    const { obligation } = loop[0]!;
    const view = {
      token: "tok123",
      state: "open",
      viewerRole: "proposer",
      proposerRole: "debtor",
      domain: { chainId: domain.chainId.toString(), verifyingContract: domain.verifyingContract },
      obligation: serializeObligation(obligation),
      document: {},
      proposerSignature: "0x",
      expiresAt: "2026-10-26T00:00:00.000Z",
    };
    const { d, store, obligations } = deps();
    obligations.getProposal.mockResolvedValue({ ok: true, proposal: view } as never);
    await grant(store, SCOPE.propose, obligation.debtor);

    const res = await handlers.createObligationProposal(caller, req({ body: { party: obligation.debtor, obligation: {}, document: {}, proposerRole: "debtor", proposerSignature: "0x" } }), d);
    expect(res.status).toBe(201);
    expect(d.tagProposal).toHaveBeenCalledWith("tok123", TENANT);
    const typed = (res.body as { proposal: { typedData: { primaryType: string; message: { amount: bigint } } } }).proposal.typedData;
    expect(typed.primaryType).toBe("NettingObligation");
    expect(typed.message.amount).toBe(100n);
  });
});

describe("apply transaction", () => {
  async function withCertificate(signed: boolean) {
    const { view, fixture } = await signedCertificate({ domain, amounts: [100n, 100n, 100n], earlyNetConsent: true });
    const shown = signed ? view : { ...view, signatures: view.signatures.map((s, i) => (i === 0 ? null : s)) };
    const me = fixture.parties[0]!.address;
    const { d, store, certificates } = deps();
    await grant(store, SCOPE.read, me);
    certificates.getCertificateView.mockResolvedValue({
      ok: true,
      certificate: { token: "c", status: signed ? "ready" : "collecting", view: serializeCertificateView(shown) },
    } as never);
    return { d, me, view };
  }

  it("returns calldata for applyCertificate with every signature once the certificate is ready", async () => {
    const { d, me, view } = await withCertificate(true);
    const res = await handlers.applyTransaction(caller, req({ params: { token: "c" }, query: new URLSearchParams({ party: me }) }), d);
    const body = res.body as { to: string; data: Hex; value: string };
    expect(body.to).toBe(domain.verifyingContract);
    expect(body.value).toBe("0");
    const decoded = decodeFunctionData({ abi: contraflowNettingLedgerAbi, data: body.data });
    expect(decoded.functionName).toBe("applyCertificate");
    expect(decoded.args?.[1]).toEqual(view.signatures);
  });

  it("refuses until every party has signed", async () => {
    const { d, me } = await withCertificate(false);
    await expect(handlers.applyTransaction(caller, req({ params: { token: "c" }, query: new URLSearchParams({ party: me }) }), d)).rejects.toMatchObject({
      status: 409,
      code: "not_ready",
    });
  });
});

describe("jsonSafe", () => {
  it("turns bigints into decimal strings, deeply", () => {
    expect(jsonSafe({ a: 1n, b: [2n, { c: 3n }], d: "x" })).toEqual({ a: "1", b: ["2", { c: "3" }], d: "x" });
  });
});
