import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  deliverDue,
  eventIdFor,
  fanOutChanges,
  type AttemptOutcome,
  type DueEvent,
  type PendingChange,
  type WebhookStore,
} from "../src/api/webhookPipeline";
import { eventTypeFor, retryDelaySeconds, signatureHeader, verifySignature, RETRY_WINDOW_SECONDS } from "../src/api/webhooks";

const NOW = new Date("2026-09-26T12:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);
const A: Address = "0x00000000000000000000000000000000000000A1";
const B: Address = "0x00000000000000000000000000000000000000B2";
const TENANT_1: Hex = `0x${"11".repeat(32)}`;
const TENANT_2: Hex = `0x${"22".repeat(32)}`;

describe("webhook signatures", () => {
  it("match Stripe's published scheme: HMAC-SHA256 over `<t>.<body>`, hex, in a t=,v1= header", () => {
    const body = '{"id":"evt_1"}';
    const header = signatureHeader(["whsec_test"], T, body);
    const expected = createHmac("sha256", "whsec_test").update(`${T}.${body}`).digest("hex");
    expect(header).toBe(`t=${T},v1=${expected}`);
  });

  it("verify against either secret while a rolled secret overlaps", () => {
    const body = "{}";
    const header = signatureHeader(["whsec_new", "whsec_old"], T, body);
    expect(verifySignature(header, body, "whsec_new", T)).toBe(true);
    expect(verifySignature(header, body, "whsec_old", T)).toBe(true);
    expect(verifySignature(header, body, "whsec_other", T)).toBe(false);
  });

  it("reject a changed body and anything outside five minutes", () => {
    const header = signatureHeader(["s"], T, "{}");
    expect(verifySignature(header, '{"x":1}', "s", T)).toBe(false);
    expect(verifySignature(header, "{}", "s", T + 301)).toBe(false);
    expect(verifySignature(header, "{}", "s", T + 300)).toBe(true);
  });
});

describe("scheduling", () => {
  it("backs off 1, 2, 4… minutes, capped at 6 hours", () => {
    expect([1, 2, 3, 4].map(retryDelaySeconds)).toEqual([60, 120, 240, 480]);
    expect(retryDelaySeconds(20)).toBe(6 * 60 * 60);
  });

  it("maps changes to event types, and ignores certificate states tenants aren't told about", () => {
    expect(eventTypeFor("obligation", "active")).toBe("obligation.recorded");
    expect(eventTypeFor("certificate", "collecting")).toBe("certificate.proposed");
    expect(eventTypeFor("certificate", "ready")).toBe("certificate.ready");
    expect(eventTypeFor("certificate", "applied")).toBe("certificate.applied");
    expect(eventTypeFor("certificate", "expired")).toBe("certificate.expired");
    expect(eventTypeFor("certificate", "abandoned")).toBe("certificate.cancelled");
    expect(eventTypeFor("certificate", "something-new")).toBeNull();
  });
});

function memoryWebhookStore(opts: {
  changes?: PendingChange[];
  parties?: Record<string, Address[]>;
  readers?: { tenantId: Hex; parties: Address[] }[];
  due?: DueEvent[];
  certificate?: { currency: string; wNet: string; appliedTxHash: string | null };
}) {
  const events = new Map<string, { tenantId: Hex; type: string; body: string }>();
  const completed: string[] = [];
  const attempts: { eventId: string; attempt: number; statusCode: number | null; outcome: AttemptOutcome }[] = [];
  const store: WebhookStore = {
    claimChanges: async () => opts.changes ?? [],
    completeChange: async (id) => void completed.push(id),
    changeContext: async (c) => (opts.parties?.[c.refId] ? { parties: opts.parties[c.refId]!, token: "tok", certificate: opts.certificate } : null),
    readersOf: async (_chain, parties) =>
      (opts.readers ?? [])
        .map((r) => ({ tenantId: r.tenantId, parties: r.parties.filter((p) => parties.includes(p)) }))
        .filter((r) => r.parties.length > 0),
    insertEvent: async (e) => {
      if (!events.has(e.eventId)) events.set(e.eventId, e);
    },
    claimDueEvents: async () => opts.due ?? [],
    hasCurrentReadAccess: async () => true,
    recordAttempt: async (eventId, attempt, result, outcome) => void attempts.push({ eventId, attempt, statusCode: result.statusCode, outcome }),
  };
  return { store, events, completed, attempts };
}

describe("fanOutChanges", () => {
  const change = (changeId: string, kind: "obligation" | "certificate", refId: string, status: string): PendingChange => ({
    changeId,
    kind,
    refId,
    chainId: "5042002",
    status,
  });

  it("puts the netted amount, currency and transaction hash on certificate events", async () => {
    const hash = `0x${"ab".repeat(32)}`;
    const { store, events } = memoryWebhookStore({
      changes: [change("9", "certificate", "0xcert", "applied")],
      parties: { "0xcert": [A, B] },
      readers: [{ tenantId: TENANT_1, parties: [A] }],
      certificate: { currency: "USD", wNet: "12345", appliedTxHash: hash },
    });
    await fanOutChanges(store, NOW);
    const data = JSON.parse(events.get(eventIdFor("9", TENANT_1))!.body).data;
    expect(data).toMatchObject({ status: "applied", currency: "USD", wNetMinor: "12345", wNetDisplay: "123.45", appliedTxHash: hash });
  });

  it("leaves the transaction hash null when it isn't known yet", async () => {
    const { store, events } = memoryWebhookStore({
      changes: [change("10", "certificate", "0xcert", "applied")],
      parties: { "0xcert": [A] },
      readers: [{ tenantId: TENANT_1, parties: [A] }],
      certificate: { currency: "USD", wNet: "100", appliedTxHash: null },
    });
    await fanOutChanges(store, NOW);
    expect(JSON.parse(events.get(eventIdFor("10", TENANT_1))!.body).data.appliedTxHash).toBeNull();
  });

  it("sends each tenant an event naming only the parties it holds read permission for", async () => {
    const { store, events, completed } = memoryWebhookStore({
      changes: [change("7", "certificate", "0xcert", "ready")],
      parties: { "0xcert": [A, B] },
      readers: [
        { tenantId: TENANT_1, parties: [A] },
        { tenantId: TENANT_2, parties: [A, B] },
      ],
    });
    expect(await fanOutChanges(store, NOW)).toBe(2);
    const one = JSON.parse(events.get(eventIdFor("7", TENANT_1))!.body);
    expect(one).toMatchObject({ type: "certificate.ready", chainId: 5042002, data: { certificateId: "0xcert", token: "tok", status: "ready", parties: [A] } });
    expect(typeof one.chainId).toBe("number");
    expect(JSON.parse(events.get(eventIdFor("7", TENANT_2))!.body).data.parties).toEqual([A, B]);
    expect(completed).toEqual(["7"]);
  });

  it("completes changes nobody is told about, so they aren't retried forever", async () => {
    const { store, events, completed } = memoryWebhookStore({
      changes: [change("1", "obligation", "0xob", "active"), change("2", "certificate", "0xc", "odd")],
      parties: { "0xob": [A, B] },
      readers: [],
    });
    expect(await fanOutChanges(store, NOW)).toBe(0);
    expect(events.size).toBe(0);
    expect(completed).toEqual(["1", "2"]);
  });

  it("is idempotent: fanning out the same change again doesn't duplicate events", async () => {
    const opts = { changes: [change("9", "obligation", "0xob", "active")], parties: { "0xob": [A, B] }, readers: [{ tenantId: TENANT_1, parties: [B] }] };
    const { store, events } = memoryWebhookStore(opts);
    await fanOutChanges(store, NOW);
    await fanOutChanges(store, NOW);
    expect(events.size).toBe(1);
  });
});

describe("deliverDue", () => {
  const due = (overrides: Partial<DueEvent> = {}): DueEvent => ({
    eventId: "evt_1",
    tenantId: TENANT_1,
    body: '{"id":"evt_1"}',
    attempts: 0,
    createdAt: NOW,
    url: "https://example.test/hook",
    secrets: ["whsec_a"],
    ...overrides,
  });

  it("marks a 2xx delivered and sends a verifiable signature and the event id", async () => {
    const { store, attempts } = memoryWebhookStore({ due: [due()] });
    let seen: Record<string, string> = {};
    const result = await deliverDue(store, NOW, async (_url, body, headers) => {
      seen = headers;
      expect(verifySignature(headers["Contraflow-Signature"]!, body, "whsec_a", T)).toBe(true);
      return 204;
    });
    expect(result).toEqual({ delivered: 1, failed: 0 });
    expect(seen["Contraflow-Event-Id"]).toBe("evt_1");
    expect(attempts[0]).toMatchObject({ attempt: 1, statusCode: 204, outcome: { kind: "delivered" } });
  });

  it("retries a 500, a redirect or a network error with backoff", async () => {
    for (const post of [async () => 500, async () => 302, async () => Promise.reject(new Error("ECONNREFUSED"))]) {
      const { store, attempts } = memoryWebhookStore({ due: [due({ attempts: 2 })] });
      await deliverDue(store, NOW, post);
      expect(attempts[0]).toMatchObject({ attempt: 3, outcome: { kind: "retry", nextAt: new Date(NOW.getTime() + 240_000) } });
    }
  });

  it("gives up once the next try would be past three days", async () => {
    const old = new Date(NOW.getTime() - (RETRY_WINDOW_SECONDS - 30) * 1000);
    const { store, attempts } = memoryWebhookStore({ due: [due({ createdAt: old, attempts: 5 })] });
    expect(await deliverDue(store, NOW, async () => 503)).toEqual({ delivered: 0, failed: 1 });
    expect(attempts[0]!.outcome).toEqual({ kind: "failed" });
  });
});
