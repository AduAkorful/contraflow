/// Runs against a real Postgres, so it only runs when `TEST_DATABASE_URL` is set (a scratch database
/// with migrations 001 to 013 applied, never the app's own). It checks what the offline tests can't:
/// that the adapter's transactions, row locks and result types behave as the stores expect, that each
/// store's SQL works on the real engine, and that the lockdown holds.
///
///   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/contraflow_test pnpm vitest run test/db.integration.test.ts

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { createDb, type Db } from "../src/db/postgres";

const url = process.env.TEST_DATABASE_URL;
const hex = (bytes: number): Hex => `0x${randomBytes(bytes).toString("hex")}`;
const address = () => hex(20);
const ZERO32 = `0x${"00".repeat(32)}` as Hex;

describe.skipIf(!url)("Postgres adapter and stores (real database)", () => {
  let db: Db;
  let other: Db;
  const stores: Record<string, any> = {};

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = createDb(url!);
    other = createDb(url!);
    stores.invoices = await import("../src/db/invoices");
    stores.documents = await import("../src/db/documents");
    stores.addresses = await import("../src/db/addresses");
    stores.obligations = await import("../src/db/obligations");
    stores.certificates = await import("../src/db/certificates");
    stores.tenants = await import("../src/db/tenants");
    stores.webhooks = await import("../src/db/webhooks");
    stores.usage = await import("../src/db/usage");
    stores.client = await import("../src/db/client");
  });

  afterAll(async () => {
    await db?.end();
    await other?.end();
    await stores.client?.sql().end();
  });

  describe("adapter", () => {
    it("returns rows with the types the stores expect", async () => {
      const [row] = await db`SELECT ${1}::int AS n, ${"x"}::text AS s, now() AS t, '{"a":1}'::jsonb AS j, count(*) AS c FROM generate_series(1, 3)`;
      expect(row).toMatchObject({ n: 1, s: "x", j: { a: 1 }, c: "3" });
      expect(row!.t).toBeInstanceOf(Date);
    });

    it("runs a query only when it is awaited", async () => {
      await db`CREATE TEMP TABLE IF NOT EXISTS lazy_probe (n int)`;
      const q = db`INSERT INTO lazy_probe VALUES (1)`;
      await new Promise((r) => setTimeout(r, 50));
      expect(await db`SELECT count(*)::int AS c FROM lazy_probe`).toEqual([{ c: 0 }]);
      await q;
      await q; // a second await shares the first run
      expect(await db`SELECT count(*)::int AS c FROM lazy_probe`).toEqual([{ c: 1 }]);
    });

    it("commits a transaction's statements in order and returns each result", async () => {
      const results = await db.transaction([db`SELECT 1 AS a`, db`SELECT 2 AS b`]);
      expect(results).toEqual([[{ a: 1 }], [{ b: 2 }]]);
    });

    it("rolls the whole transaction back when one statement fails", async () => {
      const ref = `rollback-${hex(4)}`;
      await expect(
        db.transaction([
          db`INSERT INTO invoice_documents (invoice_ref, description, debtor, creditor, amount_usdc, maturity, created_by)
             VALUES (${ref}, 'd', 'a', 'b', '1.00', '2026-12-31', 'a')`,
          db`SELECT * FROM table_that_does_not_exist`,
        ]),
      ).rejects.toThrow();
      expect(await db`SELECT 1 FROM invoice_documents WHERE invoice_ref = ${ref}`).toEqual([]);
      // the connection went back to the pool healthy
      expect(await db`SELECT 1 AS ok`).toEqual([{ ok: 1 }]);
    });

    it("holds a row lock for the whole transaction", async () => {
      const ref = `lock-${hex(4)}`;
      await db`INSERT INTO invoice_documents (invoice_ref, description, debtor, creditor, amount_usdc, maturity, created_by)
               VALUES (${ref}, 'start', 'a', 'b', '1.00', '2026-12-31', 'a')`;
      const started = Date.now();
      const holder = db.transaction([
        db`SELECT 1 FROM invoice_documents WHERE invoice_ref = ${ref} FOR UPDATE`,
        db`SELECT pg_sleep(0.4)`,
        db`UPDATE invoice_documents SET description = 'holder' WHERE invoice_ref = ${ref}`,
      ]);
      await new Promise((r) => setTimeout(r, 100));
      await other`UPDATE invoice_documents SET description = 'waiter' WHERE invoice_ref = ${ref}`;
      await holder;
      expect(Date.now() - started).toBeGreaterThanOrEqual(380);
      // the waiter ran after the holder committed
      expect(await db`SELECT description FROM invoice_documents WHERE invoice_ref = ${ref}`).toEqual([{ description: "waiter" }]);
    });

    it("lets two overlapping claimers take different rows with SKIP LOCKED", async () => {
      await db`CREATE TABLE IF NOT EXISTS skip_probe (id int PRIMARY KEY)`;
      await db`TRUNCATE skip_probe`;
      await db`INSERT INTO skip_probe VALUES (1), (2)`;
      const claim = (d: Db) =>
        d.transaction([d`SELECT id FROM skip_probe ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`, d`SELECT pg_sleep(0.3)`]);
      const [a, b] = await Promise.all([claim(db), claim(other)]);
      expect([a[0]![0]!.id, b[0]![0]!.id].sort()).toEqual([1, 2]);
      await db`DROP TABLE skip_probe`;
    });

    it("surfaces a unique violation with its SQLSTATE and constraint name", async () => {
      const ref = `dup-${hex(4)}`;
      const insert = () => db`INSERT INTO invoice_documents (invoice_ref, description, debtor, creditor, amount_usdc, maturity, created_by)
                              VALUES (${ref}, 'd', 'a', 'b', '1.00', '2026-12-31', 'a')`;
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: "23505", constraint: "invoice_documents_pkey" });
    });
  });

  describe("lockdown", () => {
    it("has row-level security on every table in public", async () => {
      expect(await db`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`).toEqual([]);
    });

    it("gives anon and authenticated no table, sequence or function privilege", async () => {
      const roles = await db`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;
      if (roles.length === 0) return; // not a Supabase-shaped database
      const grants = await db`SELECT grantee, table_name FROM information_schema.role_table_grants
                              WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`;
      expect(grants).toEqual([]);
      const executable = await db`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                  WHERE n.nspname = 'public'
                                    AND (has_function_privilege('anon', p.oid, 'execute') OR has_function_privilege('authenticated', p.oid, 'execute'))`;
      expect(executable).toEqual([]);
    });
  });

  describe("stores", () => {
    it("invoices: upserts a registration and a settlement, and reads them back case-insensitively", async () => {
      const { upsertRegisteredInvoice, upsertSettledInvoice, upsertSettlement, getInvoiceByRef, getRecentInvoicesForAddress, getInvoicesForSettlement, getSettlement } = stores.invoices;
      const debtor = address();
      const creditor = address();
      const invoiceRef = hex(32);
      const registerTxHash = hex(32);
      const registration = { invoiceRef, debtor, creditor, amountUsdc: "1650.00", maturity: "1798675200", earlyNetConsent: false, registerTxHash };
      await upsertRegisteredInvoice(registration);
      await upsertRegisteredInvoice(registration); // repeating an event never duplicates a row
      expect((await getInvoiceByRef(invoiceRef))?.status).toBe("registered");

      const settleTxHash = hex(32);
      await upsertSettlement({ settleTxHash, blockNumber: "123", wNetUsdc: "1000.00", cycleLength: 3, gasPaidWei: null });
      await upsertSettledInvoice({ ...registration, settleTxHash, wNetUsdc: "1000.00", remainingUsdc: "650.00" });
      const settled = await getInvoiceByRef(invoiceRef);
      expect(settled).toMatchObject({ status: "settled", remainingUsdc: "650.00", settleTxHash });
      expect(await getSettlement(settleTxHash)).toMatchObject({ cycleLength: 3, gasPaidWei: null });
      expect(await getInvoicesForSettlement(settleTxHash)).toHaveLength(1);
      expect(await getRecentInvoicesForAddress(debtor.toUpperCase().replace("0X", "0x"), 5)).toHaveLength(1);
    });

    it("documents: creates once, then reports identical or conflicting content", async () => {
      const { insertInvoiceDocumentIfAbsent, getInvoiceDocumentByRef } = stores.documents;
      const input = { invoiceRef: hex(32), description: "PO 7", debtor: address(), creditor: address(), amountUsdc: "5.00", maturity: "2027-01-31", createdBy: address() };
      expect(await insertInvoiceDocumentIfAbsent(input)).toBe("created");
      expect(await insertInvoiceDocumentIfAbsent(input)).toBe("identical");
      expect(await insertInvoiceDocumentIfAbsent({ ...input, description: "changed" })).toBe("conflict");
      expect((await getInvoiceDocumentByRef(input.invoiceRef))?.description).toBe("PO 7");
    });

    it("starter grants: reserve once, then complete atomically", async () => {
      const { reserveStarterGrantOperation, markStarterGrantSubmitted, completeStarterGrant, hasReceivedStarterGrant, getStarterGrantOperation } = stores.addresses;
      const who = address();
      expect((await reserveStarterGrantOperation(who)).reserved).toBe(true);
      expect((await reserveStarterGrantOperation(who)).reserved).toBe(false);
      const txHash = hex(32);
      await markStarterGrantSubmitted(who, txHash);
      expect(await hasReceivedStarterGrant(who)).toBe(false);
      await completeStarterGrant(who, txHash);
      expect(await hasReceivedStarterGrant(who)).toBe(true);
      expect(await getStarterGrantOperation(who)).toMatchObject({ status: "confirmed", txHash });
    });

    function obligationInput(debtor: string, creditor: string) {
      return {
        obligationId: hex(32), chainId: "5042002", ledger: address(), documentHash: hex(32), debtor, creditor, currency: "USD",
        amount: 125_000n, maturity: 1_800_000_000n, earlyNetConsent: false, salt: hex(32), debtorSignature: hex(65),
        creditorSignature: hex(65), description: "services", blinding: ZERO32, createdBy: debtor,
      };
    }
    async function acceptedObligation(debtor: string, creditor: string) {
      const input = obligationInput(debtor, creditor);
      const token = await stores.obligations.insertProposal({
        token: hex(16).slice(2), obligationId: input.obligationId, chainId: input.chainId, ledger: input.ledger, proposer: debtor,
        counterparty: creditor, proposerRole: "debtor", obligation: { n: 1 }, document: { d: 1 }, proposerSignature: hex(65),
      });
      expect(await stores.obligations.acceptProposalWithObligation(token, { ...input, createdBy: creditor })).toBe("accepted");
      return { input, token };
    }

    it("obligations: stores a proposal, accepts it atomically, and treats a repeat as already accepted", async () => {
      const { acceptProposalWithObligation, getObligationById, getProposalByToken, listObligationsForParty, listOpenProposalsForParty } = stores.obligations;
      const debtor = address();
      const creditor = address();
      const { input, token } = await acceptedObligation(debtor, creditor);
      expect(await acceptProposalWithObligation(token, { ...input, createdBy: creditor })).toBe("already_accepted");
      expect((await getProposalByToken(token))?.status).toBe("accepted");
      expect(await getObligationById(input.obligationId)).toMatchObject({ remaining: "125000", status: "active" });
      expect(await listObligationsForParty(debtor)).toHaveLength(1);
      expect(await listOpenProposalsForParty(creditor)).toEqual([]);
    });

    it("obligations: a second obligation for the same document and pair is refused", async () => {
      const { DuplicateObligationError } = stores.obligations;
      const debtor = address();
      const creditor = address();
      const first = await acceptedObligation(debtor, creditor);
      const second = { ...obligationInput(debtor, creditor), documentHash: first.input.documentHash };
      const token = await stores.obligations.insertProposal({
        token: hex(16).slice(2), obligationId: second.obligationId, chainId: second.chainId, ledger: first.input.ledger, proposer: debtor,
        counterparty: creditor, proposerRole: "debtor", obligation: {}, document: {}, proposerSignature: hex(65),
      });
      await expect(
        stores.obligations.acceptProposalWithObligation(token, { ...second, ledger: first.input.ledger, createdBy: creditor }),
      ).rejects.toBeInstanceOf(DuplicateObligationError);
    });

    it("certificates: locks obligations, collects signatures, and applies atomically", async () => {
      const store = stores.certificates.postgresCertificateStore;
      const a = address();
      const b = address();
      const c = address();
      const ledger = address();
      const make = async (debtor: string, creditor: string) => {
        const { input } = await acceptedObligation(debtor, creditor);
        await db`UPDATE netting_obligations SET ledger = ${ledger} WHERE obligation_id = ${input.obligationId}`;
        return input.obligationId as string;
      };
      const ids = [await make(a, b), await make(b, c), await make(c, a)];
      const entries = [[a, b], [b, c], [c, a]].map(([debtor, creditor], i) => ({
        obligationId: ids[i]!, debtor: debtor!, creditor: creditor!, remaining: "125000", blinding: ZERO32,
      }));
      const certificate = {
        certificateId: hex(32), token: hex(16).slice(2), chainId: "5042002", ledger, currency: "USD", wNet: "125000",
        deadline: String(Math.floor(Date.now() / 1000) + 3600), contentHash: hex(32), fullView: { v: 1 }, proposedBy: a, entries,
      };
      expect(await store.insertCertificate(certificate)).toBe("inserted");
      // the same obligations can't join a second open certificate
      expect(await store.insertCertificate({ ...certificate, certificateId: hex(32), token: hex(16).slice(2) })).toBe("locked");

      expect(await store.addSignature({ certificateId: certificate.certificateId, idx: 0, signer: a, signature: hex(65), required: 3 })).toBe("stored");
      expect(await store.addSignature({ certificateId: certificate.certificateId, idx: 0, signer: a, signature: hex(65), required: 3 })).toBe("already_present");
      await store.addSignature({ certificateId: certificate.certificateId, idx: 1, signer: b, signature: hex(65), required: 3 });
      await store.addSignature({ certificateId: certificate.certificateId, idx: 2, signer: c, signature: hex(65), required: 3 });
      expect((await store.getCertificateByToken(certificate.token))?.status).toBe("ready");

      const after = hex(32);
      await store.finalizeApplied({
        certificateId: certificate.certificateId,
        txHash: hex(32),
        entries: ids.map((obligationId) => ({
          obligationId, before: { remaining: "125000", blinding: ZERO32 }, after: { remaining: "0", blinding: after }, movedOn: false,
        })),
      });
      const applied = await store.getCertificateById(certificate.certificateId);
      expect(applied).toMatchObject({ status: "applied" });
      expect(applied.entries.every((e: { locked: boolean }) => !e.locked)).toBe(true);
      expect(await store.getObligationById(ids[0]!)).toMatchObject({ remaining: "0", blinding: after });
      expect((await store.listCertificatesForParty(b))[0]?.certificateId).toBe(certificate.certificateId);
    });

    it("certificates: closing an obligation abandons a collecting certificate and releases its locks", async () => {
      const store = stores.certificates.postgresCertificateStore;
      const [a, b] = [address(), address()];
      const ledger = address();
      const { input } = await acceptedObligation(a, b);
      await db`UPDATE netting_obligations SET ledger = ${ledger} WHERE obligation_id = ${input.obligationId}`;
      const certificate = {
        certificateId: hex(32), token: hex(16).slice(2), chainId: "5042002", ledger, currency: "USD", wNet: "125000",
        deadline: String(Math.floor(Date.now() / 1000) + 3600), contentHash: hex(32), fullView: {}, proposedBy: a,
        entries: [{ obligationId: input.obligationId, debtor: a, creditor: b, remaining: "125000", blinding: ZERO32 }],
      };
      expect(await store.insertCertificate(certificate)).toBe("inserted");
      expect(await store.closeObligation(input.obligationId, a)).toBe("closed");
      expect((await store.getCertificateById(certificate.certificateId)).status).toBe("abandoned");
      expect((await store.getObligationById(input.obligationId)).status).toBe("closed");
    });

    it("api idempotency: claims once, blocks a concurrent repeat, then replays the stored result", async () => {
      const { claimIdempotency, completeIdempotency } = stores.tenants;
      const tenantId = hex(32);
      await db`INSERT INTO tenants (tenant_id, name) VALUES (${tenantId}, 'test')`;
      const key = `k-${hex(4)}`;
      const first = await claimIdempotency(tenantId, key, "hash-1");
      expect(first.kind).toBe("new");
      expect((await claimIdempotency(tenantId, key, "hash-1")).kind).toBe("in_progress");
      expect((await claimIdempotency(tenantId, key, "different")).kind).toBe("conflict");
      await completeIdempotency(tenantId, key, 201, { ok: true }, first.leaseToken);
      expect(await claimIdempotency(tenantId, key, "hash-1")).toEqual({ kind: "replay", status: 201, body: { ok: true } });
    });

    it("permissions: saving under an Idempotency-Key stores the permission and its replayable result in one statement", async () => {
      const { claimIdempotency, postgresTenantStore } = stores.tenants;
      const tenantId = hex(32);
      await db`INSERT INTO tenants (tenant_id, name) VALUES (${tenantId}, 'test')`;
      const key = `k-${hex(4)}`;
      const claim = await claimIdempotency(tenantId, key, "hash-p");
      const party = address();
      const saved = await postgresTenantStore.savePermission(
        {
          permissionId: `perm_${hex(6)}`,
          tenantId,
          chainId: 5042002,
          party,
          scopes: 7,
          expiresAt: 1_900_000_000n,
          nonce: hex(16),
          signature: hex(65),
        },
        { key, requestHash: "hash-p", leaseToken: claim.leaseToken },
      );
      expect(saved).toBe(true);
      const replay = await claimIdempotency(tenantId, key, "hash-p");
      expect(replay).toMatchObject({ kind: "replay", status: 201, body: { party, scopes: 7, expiresAt: "1900000000" } });
    });

    it("api keys: finds an active key by hash and reports a revoked one", async () => {
      const store = stores.tenants.postgresTenantStore;
      const tenantId = hex(32);
      const keyHash = hex(32).slice(2);
      await db`INSERT INTO tenants (tenant_id, name) VALUES (${tenantId}, 'keys')`;
      await db`INSERT INTO tenant_api_keys (key_hash, tenant_id, mode, prefix) VALUES (${keyHash}, ${tenantId}, 'test', 'cfk_test_xxxx')`;
      expect(await store.findKey(keyHash)).toMatchObject({ tenantId, mode: "test", revoked: false, tenantActive: true });
      await db`UPDATE tenant_api_keys SET revoked_at = now() WHERE key_hash = ${keyHash}`;
      expect((await store.findKey(keyHash))?.revoked).toBe(true);
    });

    it("webhooks: a new obligation is captured by the trigger and claimed once", async () => {
      const store = stores.webhooks.postgresWebhookStore;
      const before = await store.claimChanges(1000);
      for (const change of before) await store.completeChange(change.changeId);
      const { input } = await acceptedObligation(address(), address());
      const claimed = await store.claimChanges(10);
      expect(claimed.map((c: { refId: string }) => c.refId)).toContain(input.obligationId);
      expect(await store.claimChanges(10)).toEqual([]); // leased until completed
      for (const change of claimed) await store.completeChange(change.changeId);
    });

    it("usage: counts accumulate per key, the key stamp is throttled, and tenants are isolated", async () => {
      const { recordUsage, getTenantUsage, purgeOldUsage } = stores.usage;
      const a = hex(32);
      const b = hex(32);
      const keyHash = hex(32).slice(2);
      const party = address().toLowerCase();
      await db`INSERT INTO tenants (tenant_id, name) VALUES (${a}, 'usage a'), (${b}, 'usage b')`;
      await db`INSERT INTO tenant_api_keys (key_hash, tenant_id, mode, prefix) VALUES (${keyHash}, ${a}, 'test', 'cfk_test_use1')`;
      const rec = (tenantId: Hex, over: Record<string, unknown> = {}) =>
        recordUsage({ tenantId, operation: "findLoop", party, statusClass: "2xx", errorCode: "", keyHash: null, ...over });
      await Promise.all([rec(a, { keyHash }), rec(a), rec(a, { statusClass: "4xx", errorCode: "not_found", party: "" }), rec(b)]);
      await rec(a, { keyHash }); // inside the throttle window: the stamp must not move

      const [first] = (await db`SELECT last_used_at FROM tenant_api_keys WHERE key_hash = ${keyHash}`) as { last_used_at: string }[];
      expect(first?.last_used_at).not.toBeNull();
      await rec(a, { keyHash });
      const [second] = (await db`SELECT last_used_at FROM tenant_api_keys WHERE key_hash = ${keyHash}`) as { last_used_at: string }[];
      expect(new Date(second!.last_used_at).getTime()).toBe(new Date(first!.last_used_at).getTime());

      const today = new Date().toISOString().slice(0, 10);
      const usage = await getTenantUsage({ tenantId: a, from: today, to: today, nowSeconds: BigInt(Math.floor(Date.now() / 1000)) });
      expect(usage.totals.requests).toBe(5);
      expect(usage.totals.byStatusClass).toEqual({ "2xx": 4, "4xx": 1, "5xx": 0 });
      expect(usage.totals.topErrorCodes).toEqual([{ code: "not_found", count: 1 }]);
      expect(usage.parties).toHaveLength(1);
      expect(usage.parties[0]).toMatchObject({ party, requests: 4, permission: { status: "none" } });
      expect(usage.keys[0]).toMatchObject({ prefix: "cfk_test_use1", revoked: false });

      const other = await getTenantUsage({ tenantId: b, from: today, to: today, nowSeconds: 0n });
      expect(other.totals.requests).toBe(1);

      await db`INSERT INTO tenant_usage_daily (tenant_id, day, operation, status_class, count)
               VALUES (${a}, (now() AT TIME ZONE 'utc')::date - 120, 'findLoop', '2xx', 9)`;
      expect(await purgeOldUsage()).toBeGreaterThanOrEqual(1);
      const left = (await db`SELECT count(*)::int AS n FROM tenant_usage_daily WHERE tenant_id = ${a} AND day < (now() AT TIME ZONE 'utc')::date - 90`) as { n: number }[];
      expect(left[0]?.n).toBe(0);
    });
  });
});
