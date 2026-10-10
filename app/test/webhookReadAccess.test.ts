import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: unknown[][] = [];
let countRow = 1;

vi.mock("../src/db/client", () => ({
  withDbRetry: async <T>(run: () => Promise<T>) => run(),
  sql: () => async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(values);
    return [{ authorized_count: countRow, status: "active" }];
  },
}));

const A = "0x4e71B023324BB2F66Fe3E4153BC4b40Fb913b24F";
const B = "0x3EB62da85e00c34D418818df3831e984854F689B";
const tenantId = `0x${"12".repeat(32)}` as const;

async function check(body: object) {
  const { postgresWebhookStore } = await import("../src/db/webhooks");
  return postgresWebhookStore.hasCurrentReadAccess(
    { eventId: "evt", tenantId, body: JSON.stringify(body), attempts: 0, createdAt: new Date(), url: "https://x.test", secrets: ["s"] },
    1_790_000_000n,
  );
}

describe("webhook read-access check", () => {
  beforeEach(() => {
    queries.length = 0;
    countRow = 2;
  });

  it("accepts an event whose chainId is a JSON number and looks up that chain", async () => {
    const ok = await check({ type: "obligation.recorded", chainId: 5042002, data: { parties: [A, B] } });
    expect(ok).toBe(true);
    expect(queries[0]).toContain("5042002");
  });

  it("still accepts a stored event whose chainId is a numeric string", async () => {
    expect(await check({ type: "obligation.recorded", chainId: "5042002", data: { parties: [A, B] } })).toBe(true);
  });

  it("refuses a missing, malformed or non-integer chainId", async () => {
    for (const chainId of [undefined, "abc", 5042002.5, null]) {
      expect(await check({ type: "certificate.ready", chainId, data: { parties: [A] } })).toBe(false);
    }
  });

  it("refuses when fewer parties are authorised than the event names", async () => {
    countRow = 1;
    expect(await check({ type: "obligation.recorded", chainId: 5042002, data: { parties: [A, B] } })).toBe(false);
  });
});
