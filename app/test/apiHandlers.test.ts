import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { ApiCaller } from "../src/api/auth";
import type { OwnWebhookStore } from "../src/api/ownWebhook";
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

function memoryWebhookStore(): OwnWebhookStore {
  const rows = new Map<string, { url: string; secret: string; rolling: boolean }>();
  return {
    get: async (id) => {
      const row = rows.get(id);
      return row ? { url: row.url, rollingUntil: row.rolling ? "2026-10-12T00:00:00.000Z" : null } : null;
    },
    save: async (id, url, secret) => {
      rows.set(id, { url, secret, rolling: false });
      return "saved";
    },
    roll: async (id, secret) => {
      const row = rows.get(id);
      if (!row) return "no_endpoint";
      rows.set(id, { ...row, secret, rolling: true });
      return "rolled";
    },
    remove: async (id) => (rows.delete(id) ? "removed" : "no_endpoint"),
    tenant: async () => ({ tenantId: TENANT, status: "active" }),
    recent: async () => [
      { eventId: "evt_1", type: "certificate.applied", status: "delivered", attempts: 1, createdAt: "2026-10-11T00:00:00.000Z", statusCode: 200, error: null },
    ],
  };
}

function deps(overrides: Partial<ApiDeps> = {}) {
  const store = memoryTenantStore();
  const obligations = {
    createProposal: vi.fn(async () => ({ ok: true as const, token: "tok123" })),
    getProposal: vi.fn(),
    getProposalForObligation: vi.fn(async () => ({ ok: false as const, error: "Not found." })),
    acceptProposal: vi.fn(async () => ({ ok: true as const })),
    withdrawProposal: vi.fn(async () => ({ ok: true as const })),
    listMine: vi.fn(async () => ({ ok: true as const, proposals: [] as { token: string }[], obligations: [] as { obligationId: string }[] })),
  };
  const certificates = {
    listCertificates: vi.fn(async () => ({ ok: true as const, certificates: [] as { token: string }[] })),
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
    enqueueWebhookTest: vi.fn(async () => ({ eventId: "evt_test_1" })),
    webhookEndpoint: memoryWebhookStore(),
    resolveWebhookHost: async () => [{ address: "93.184.216.34" }],
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
    const typed = (res.body as { proposal: { typedData: { domain: { chainId: number }; primaryType: string; message: { amount: string } }; digest: string } }).proposal;
    expect(typed.typedData.primaryType).toBe("NettingObligation");
    expect(typed.typedData.domain.chainId).toBe(TESTNET);
    expect(typed.typedData.message.amount).toBe("100");
    expect(typed.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect((res.body as { proposal: { appUrl: string } }).proposal.appUrl).toContain("/app/o/tok123");
  });

  it("answers 409 duplicate_proposal, with the stored proposal's token and link, when proposed again", async () => {
    const { d, store, obligations } = deps();
    obligations.createProposal.mockResolvedValue({ ok: true, token: "tok123", existing: true } as never);
    await grant(store, SCOPE.propose, party);
    await expect(
      handlers.createObligationProposal(caller, req({ body: { party, obligation: {}, document: {}, proposerRole: "debtor", proposerSignature: "0x" } }), d),
    ).rejects.toMatchObject({
      status: 409,
      code: "duplicate_proposal",
      details: { proposalToken: "tok123", appUrl: expect.stringContaining("/app/o/tok123") },
    });
  });

  it("recovers a create from the stored proposal instead of inserting again", async () => {
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
    obligations.getProposalForObligation.mockResolvedValue({ ok: true, proposal: view } as never);
    await grant(store, SCOPE.propose, obligation.debtor);
    const recovered = await handlers.recoverCreateObligationProposal(
      caller,
      req({ body: { party: obligation.debtor, obligation } }),
      d,
    );
    expect(recovered?.status).toBe(201);
    expect((recovered?.body as { proposal: { token: string } }).proposal.token).toBe("tok123");
    expect(obligations.createProposal).not.toHaveBeenCalled();
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
    const body = res.body as { to: string; data: Hex; value: string; chainId: number; submit: { anyFundedWallet: boolean; estimatedGas: string | null; appUrl: string } };
    expect(body.submit).toMatchObject({ anyFundedWallet: true, estimatedGas: null });
    expect(body.submit.appUrl).toContain("/app/c/c");
    expect(body.chainId).toBe(TESTNET);
    expect(body.to).toBe(domain.verifyingContract);
    expect(body.value).toBe("0");
    const decoded = decodeFunctionData({ abi: contraflowNettingLedgerAbi, data: body.data });
    expect(decoded.functionName).toBe("applyCertificate");
    expect(decoded.args?.[1]).toEqual(view.signatures);
  });

  it("says so when the certificate has already been applied, expired or cancelled", async () => {
    const { view, fixture } = await signedCertificate({ domain, amounts: [100n, 100n, 100n], earlyNetConsent: true });
    const me = fixture.parties[0]!.address;
    const expectations: [string, string, RegExp][] = [
      ["applied", "already_applied", /already been applied/],
      ["expired", "not_ready", /expired/],
      ["abandoned", "not_ready", /cancelled/],
    ];
    for (const [status, code, message] of expectations) {
      const { d, store, certificates } = deps();
      await grant(store, SCOPE.read, me);
      certificates.getCertificateView.mockResolvedValue({
        ok: true,
        certificate: { token: "c", status, view: serializeCertificateView(view) },
      } as never);
      await expect(
        handlers.applyTransaction(caller, req({ params: { token: "c" }, query: new URLSearchParams({ party: me }) }), d),
      ).rejects.toMatchObject({ status: 409, code, message: expect.stringMatching(message) });
    }
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

describe("typed-data responses", () => {
  it("emits chainId as a number and a digest viem hashes to", async () => {
    const { hashTypedData } = await import("viem");
    const { permissionTypedData } = await import("../src/api/permissions");
    const res = await handlers.permissionPayload(
      caller,
      req({
        query: new URLSearchParams({
          party,
          scopes: "7",
          expiresAt: (NOW + 60n).toString(),
          nonce: `0x${"33".repeat(32)}`,
        }),
      }),
      deps().d,
    );
    const body = res.body as { typedData: { domain: { chainId: number }; types: object; primaryType: string; message: object }; digest: `0x${string}` };
    expect(body.typedData.domain.chainId).toBe(TESTNET);
    expect(typeof body.typedData.domain.chainId).toBe("number");
    expect(hashTypedData(body.typedData as never)).toBe(body.digest);
    const original = permissionTypedData(TESTNET, {
      party,
      tenantId: TENANT,
      scopes: 7,
      expiresAt: NOW + 60n,
      nonce: `0x${"33".repeat(32)}`,
    });
    expect(hashTypedData({ ...body.typedData, domain: { ...body.typedData.domain, chainId: String(TESTNET) } } as never)).not.toBe(
      body.digest,
    );
    expect(hashTypedData(original)).toBe(body.digest);
  });

  it("rejects typed-data scopes that are not a permission bitmask", async () => {
    await expect(
      handlers.permissionPayload(
        caller,
        req({ query: new URLSearchParams({ party, scopes: "8", expiresAt: (NOW + 60n).toString(), nonce: `0x${"33".repeat(32)}` }) }),
        deps().d,
      ),
    ).rejects.toMatchObject({ status: 422, code: "invalid_request" });
  });
});

describe("tenant and webhook helpers", () => {
  it("returns this tenant without a party permission", async () => {
    const { d } = deps();
    expect(await handlers.getTenant(caller, req(), d)).toMatchObject({
      status: 200,
      body: { tenantId: TENANT, name: "test", mode: "test", chainId: TESTNET, webhookConfigured: false },
    });
  });

  it("shows an expired permission as expired, not just not-revoked", async () => {
    const { d, store } = deps();
    await store.savePermission({
      permissionId: "old",
      tenantId: TENANT,
      chainId: TESTNET,
      party,
      scopes: SCOPE.read,
      expiresAt: NOW - 10n,
      nonce: `0x${"1".repeat(64)}`,
      signature: "0x",
    });
    await grant(store, SCOPE.read);
    const body = (await handlers.listPermissions(caller, req(), d)).body as { permissions: { permissionId: string; revoked: boolean; expired: boolean; status: string }[] };
    expect(body.permissions.find((p) => p.permissionId === "old")).toMatchObject({ revoked: false, expired: true, status: "expired" });
    expect(body.permissions.find((p) => p.permissionId !== "old")).toMatchObject({ expired: false, status: "active" });
  });

  it("lists stored permissions, optionally filtered by party", async () => {
    const { d, store } = deps();
    await grant(store, SCOPE.read);
    const all = await handlers.listPermissions(caller, req(), d);
    expect((all.body as { permissions: { party: string }[] }).permissions).toHaveLength(1);
    const none = await handlers.listPermissions(
      caller,
      req({ query: new URLSearchParams({ party: "0x0000000000000000000000000000000000000001" }) }),
      d,
    );
    expect((none.body as { permissions: unknown[] }).permissions).toEqual([]);
  });

  it("enqueues a test webhook, or 422 when none is registered", async () => {
    const { d } = deps();
    expect(await handlers.testWebhook(caller, req(), d)).toEqual({
      status: 202,
      body: { eventId: "evt_test_1", type: "webhook.test" },
    });
    const missing = deps({ enqueueWebhookTest: async () => ({ error: "no_endpoint" as const }) });
    await expect(handlers.testWebhook(caller, req(), missing.d)).rejects.toMatchObject({ status: 422, code: "no_webhook" });
  });
});

describe("obligation list pagination", () => {
  it("returns nextCursor when more items remain", async () => {
    const { d, store, obligations, certificates } = deps();
    await grant(store, SCOPE.read);
    const proposal = {
      token: "a",
      waitingOn: "them" as const,
      youOwe: true,
      counterparty: party,
      currency: "USD",
      amount: "100.00",
      description: "Retainer",
      expiresAt: "2026-10-26T13:29:01.000Z",
    };
    obligations.listMine.mockResolvedValue({
      ok: true as const,
      proposals: [proposal, { ...proposal, token: "b" }],
      obligations: [],
    });
    certificates.listCertificates.mockResolvedValue({ ok: true as const, certificates: [] });
    const res = await handlers.listPartyObligations(
      caller,
      req({ params: { address: party }, query: new URLSearchParams({ limit: "1" }) }),
      d,
    );
    expect(res.status).toBe(200);
    const body = res.body as { proposals: { token: string; amountMinor: string; amountDisplay: string; expiresAt: string }[]; nextCursor: string | null };
    expect(body.proposals).toEqual([
      {
        token: "a",
        waitingOn: "them",
        youOwe: true,
        counterparty: party,
        currency: "USD",
        amountMinor: "10000",
        amountDisplay: "100.00",
        description: "Retainer",
        expiresAt: "1793021341",
        appUrl: expect.stringContaining("/app/o/a"),
      },
    ]);
    expect(typeof body.nextCursor).toBe("string");
  });
});

describe("webhook endpoint over the API", () => {
  const URL_OK = "https://example.com/contraflow/webhooks";

  it("starts with no endpoint and never returns a secret from GET", async () => {
    const { d } = deps();
    const res = await handlers.getWebhookEndpoint(caller, req(), d);
    expect(res.body).toMatchObject({ endpoint: null, recentDeliveries: [{ eventId: "evt_1", createdAt: "1791676800" }] });
    expect(JSON.stringify(res.body)).not.toMatch(/whsec_/);
  });

  it("sets an endpoint and returns the signing secret once", async () => {
    const { d } = deps();
    const set = await handlers.setWebhookEndpoint(caller, req({ body: { url: URL_OK } }), d);
    expect(set.status).toBe(200);
    expect((set.body as { secret: string }).secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const read = await handlers.getWebhookEndpoint(caller, req(), d);
    expect(read.body).toMatchObject({ endpoint: { url: URL_OK, secretRollingUntil: null } });
    expect(JSON.stringify(read.body)).not.toMatch(/whsec_/);
  });

  it("refuses an unsafe or malformed URL and stores nothing", async () => {
    const { d } = deps();
    for (const url of ["http://example.com/x", "https://127.0.0.1/x", "https://169.254.169.254/latest", "https://user:pw@example.com/x", "nope"]) {
      await expect(handlers.setWebhookEndpoint(caller, req({ body: { url } }), d)).rejects.toMatchObject({ status: 422, code: "invalid_request" });
    }
    await expect(handlers.setWebhookEndpoint(caller, req({ body: {} }), d)).rejects.toMatchObject({ status: 422, code: "invalid_request" });
    expect((await handlers.getWebhookEndpoint(caller, req(), d)).body).toMatchObject({ endpoint: null });
  });

  it("rolls the secret, and says so when there is no endpoint", async () => {
    const { d } = deps();
    await expect(handlers.rollWebhookSecret(caller, req(), d)).rejects.toMatchObject({ status: 422, code: "no_webhook" });
    await handlers.setWebhookEndpoint(caller, req({ body: { url: URL_OK } }), d);
    const rolled = await handlers.rollWebhookSecret(caller, req(), d);
    expect((rolled.body as { secret: string }).secret).toMatch(/^whsec_/);
    expect((await handlers.getWebhookEndpoint(caller, req(), d)).body).toMatchObject({ endpoint: { secretRollingUntil: "1791763200" } });
  });

  it("removes the endpoint, then reports none to remove", async () => {
    const { d } = deps();
    await handlers.setWebhookEndpoint(caller, req({ body: { url: URL_OK } }), d);
    expect(await handlers.deleteWebhookEndpoint(caller, req(), d)).toEqual({ status: 204, body: null });
    await expect(handlers.deleteWebhookEndpoint(caller, req(), d)).rejects.toMatchObject({ status: 422, code: "no_webhook" });
  });
});

describe("obligation status in lists", () => {
  it("shows a fully netted obligation as closed with its reason", async () => {
    const { d, store, obligations } = deps();
    await grant(store, SCOPE.read);
    const base = { currency: "USD", amount: "10000", counterparty: party, youOwe: true, maturity: "1", description: "x" };
    obligations.listMine.mockResolvedValue({
      ok: true,
      proposals: [],
      obligations: [
        { ...base, obligationId: "0xa", remaining: "0", status: "active" },
        { ...base, obligationId: "0xb", remaining: "500", status: "active" },
        { ...base, obligationId: "0xc", remaining: "500", status: "closed" },
      ],
    } as never);
    const res = await handlers.listPartyObligations(caller, req({ params: { address: party } }), d);
    const rows = (res.body as { obligations: { obligationId: string; status: string; closedReason?: string }[] }).obligations;
    const by = Object.fromEntries(rows.map((r) => [r.obligationId, r]));
    expect(by["0xa"]).toMatchObject({ status: "closed", closedReason: "netted" });
    expect(by["0xb"]).toMatchObject({ status: "active" });
    expect(by["0xb"]!.closedReason).toBeUndefined();
    expect(by["0xc"]).toMatchObject({ status: "closed", closedReason: "closed_by_party" });
  });
});

describe("batch proposals", () => {
  it("returns a result per item and reports duplicates and a spent budget without dropping any", async () => {
    const { d, store, obligations } = deps();
    await grant(store, SCOPE.propose, party);
    const calls = [
      { ok: true as const, token: "t1" },
      { ok: true as const, token: "t2", existing: true },
      { ok: false as const, error: "Too many requests. Try again shortly." },
    ];
    obligations.createProposal.mockImplementation(async () => calls.shift() as never);
    obligations.getProposal.mockResolvedValue({
      ok: true,
      proposal: {
        token: "t1",
        domain: { chainId: domain.chainId.toString(), verifyingContract: domain.verifyingContract },
        obligation: serializeObligation({ documentHash: `0x${"11".repeat(32)}`, debtor: party, creditor: party, currency: "USD", amount: 100n, maturity: 1n, earlyNetConsent: true, salt: `0x${"22".repeat(32)}` }),
        document: {},
        proposerSignature: "0x",
        expiresAt: "2026-10-26T00:00:00.000Z",
      },
    } as never);
    const item = { obligation: {}, document: {}, proposerRole: "debtor", proposerSignature: "0x" };
    const res = await handlers.createObligationProposals(caller, req({ body: { party, proposals: [item, item, item, item] } }), d);
    const body = res.body as { results: { index: number; status: number; error?: { code: string; details?: { proposalToken: string } } }[]; created: number; failed: number };
    expect(res.status).toBe(200);
    expect(body.results.map((r) => r.status)).toEqual([201, 409, 429, 429]);
    expect(body.results[1]!.error).toMatchObject({ code: "duplicate_proposal", details: { proposalToken: "t2" } });
    expect(body.results[3]!.error!.code).toBe("rate_limited");
    expect(body).toMatchObject({ created: 1, failed: 3 });
    expect(obligations.createProposal).toHaveBeenCalledTimes(3);
  });

  it("refuses an empty or oversized batch", async () => {
    const { d, store } = deps();
    await grant(store, SCOPE.propose, party);
    await expect(handlers.createObligationProposals(caller, req({ body: { party, proposals: [] } }), d)).rejects.toMatchObject({ status: 422 });
    await expect(
      handlers.createObligationProposals(caller, req({ body: { party, proposals: Array.from({ length: 26 }, () => ({})) } }), d),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("GET /events", () => {
  const rows = [
    { seq: "5", status: "delivered", body: JSON.stringify({ id: "evt_a", type: "certificate.applied", created: 1, chainId: 5042002, data: { parties: [party] } }) },
    { seq: "6", status: "pending", body: JSON.stringify({ id: "evt_b", type: "obligation.recorded", created: 2, chainId: 5042002, data: { parties: [party] } }) },
    { seq: "7", status: "suppressed", body: JSON.stringify({ id: "evt_c", type: "certificate.ready", created: 3, chainId: 5042002, data: { parties: [party] } }) },
  ];

  it("pages events after a cursor, skipping suppressed and no-longer-readable ones", async () => {
    const list = vi.fn(async () => rows);
    const canRead = vi.fn(async (_t: string, body: string) => !body.includes("evt_b"));
    const { d } = deps({ eventLog: { list, canRead } } as never);
    const res = await handlers.listEvents(caller, req({ query: new URLSearchParams({ after: "4", limit: "3" }) }), d);
    expect(list).toHaveBeenCalledWith(TENANT, "4", 3);
    const body = res.body as { events: { id: string; cursor: string }[]; nextCursor: string; hasMore: boolean };
    expect(body.events).toEqual([expect.objectContaining({ id: "evt_a", cursor: "5" })]);
    expect(body.nextCursor).toBe("7");
    expect(body.hasMore).toBe(true);
  });

  it("keeps the cursor when nothing is new and rejects a bad cursor or limit", async () => {
    const { d } = deps({ eventLog: { list: async () => [], canRead: async () => true } } as never);
    expect((await handlers.listEvents(caller, req({ query: new URLSearchParams({ after: "9" }) }), d)).body).toMatchObject({ events: [], nextCursor: "9", hasMore: false });
    await expect(handlers.listEvents(caller, req({ query: new URLSearchParams({ after: "x" }) }), d)).rejects.toMatchObject({ status: 422 });
    await expect(handlers.listEvents(caller, req({ query: new URLSearchParams({ limit: "500" }) }), d)).rejects.toMatchObject({ status: 422 });
  });
});

describe("disputes over the API", () => {
  it("disputes and withdraws as the party, under the propose scope", async () => {
    const { d, store, certificates } = deps();
    await grant(store, SCOPE.propose, party);
    const dispute = vi.fn(async () => ({ ok: true as const }));
    const withdraw = vi.fn(async () => ({ ok: true as const }));
    (certificates as unknown as Record<string, unknown>).disputeObligation = dispute;
    (certificates as unknown as Record<string, unknown>).withdrawDispute = withdraw;
    const id = `0x${"ab".repeat(32)}`;
    const res = await handlers.disputeObligationHandler(caller, req({ params: { obligationId: id }, body: { party, note: "Not delivered" } }), d);
    expect(res).toEqual({ status: 200, body: { disputed: true } });
    expect(dispute).toHaveBeenCalledWith(party, id, "Not delivered");
    const back = await handlers.withdrawDisputeHandler(caller, req({ params: { obligationId: id }, query: new URLSearchParams({ party }) }), d);
    expect(back).toEqual({ status: 204, body: null });
    expect(withdraw).toHaveBeenCalledWith(party, id);
  });

  it("replies to a dispute as the party, under the propose scope", async () => {
    const { d, store, certificates } = deps();
    await grant(store, SCOPE.propose, party);
    const reply = vi.fn(async () => ({ ok: true as const }));
    (certificates as unknown as Record<string, unknown>).replyToDispute = reply;
    const id = `0x${"ab".repeat(32)}`;
    const res = await handlers.replyToDisputeHandler(caller, req({ params: { obligationId: id }, body: { party, note: "Delivered" } }), d);
    expect(res).toEqual({ status: 200, body: { replied: true } });
    expect(reply).toHaveBeenCalledWith(party, id, "Delivered");
  });

  it("needs a propose permission for the party", async () => {
    const { d, store } = deps();
    await grant(store, SCOPE.read, party);
    await expect(
      handlers.disputeObligationHandler(caller, req({ params: { obligationId: `0x${"ab".repeat(32)}` }, body: { party } }), d),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("declining a certificate over the API", () => {
  it("declines as the party under deliverSignatures, and a propose-only grant can't", async () => {
    const { d, store, certificates } = deps();
    await grant(store, SCOPE.deliverSignatures, party);
    const decline = vi.fn(async () => ({ ok: true as const }));
    (certificates as unknown as Record<string, unknown>).declineCertificate = decline;
    const res = await handlers.declineCertificateHandler(
      caller,
      req({ params: { token: "tok" }, query: new URLSearchParams({ party }) }),
      d,
    );
    expect(res).toEqual({ status: 204, body: null });
    expect(decline).toHaveBeenCalledWith(party, "tok");
  });

  it("answers 409 conflict when searches collide and stay lost", async () => {
    const { d, store, certificates } = deps();
    await grant(store, SCOPE.propose, party);
    (certificates as unknown as Record<string, unknown>).findAndProposeLoop = async () => ({
      ok: false,
      error: "Another search took these obligations at the same moment. Try again.",
    });
    await expect(
      handlers.findLoop(caller, req({ params: { address: party } }), d),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });
});
