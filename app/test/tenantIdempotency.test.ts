import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/db/client", () => ({
  sql: () => (strings: TemplateStringsArray, ...values: unknown[]) => mocks.query(strings.join(" "), values),
  withDbRetry: (fn: () => Promise<unknown>) => fn(),
}));

import { claimIdempotency, completeIdempotency } from "../src/db/tenants";

const tenant = `0x${"ab".repeat(32)}` as const;

describe("tenant idempotency lease recovery", () => {
  beforeEach(() => mocks.query.mockReset());

  it("recovers an expired reservation only when the operation is marked recoverable", async () => {
    mocks.query
      .mockResolvedValueOnce([]) // initial INSERT collided
      .mockResolvedValueOnce([{ request_hash: "hash-1", status_code: 0, response: null }])
      .mockResolvedValueOnce([{ idem_key: "key-1" }]);

    const result = await claimIdempotency(tenant, "key-1", "hash-1", true);

    expect(result).toMatchObject({ kind: "recovered" });
    expect(typeof (result as { leaseToken?: unknown }).leaseToken).toBe("string");
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.query.mock.calls[2]![0]).toContain("lease_expires_at <= now()");
  });

  it("does not reclaim a pending reservation for an operation without reconciliation", async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ request_hash: "hash-1", status_code: 0, response: null }]);

    await expect(claimIdempotency(tenant, "key-1", "hash-1")).resolves.toEqual({ kind: "in_progress" });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("completes only the current lease owner and clears lease metadata", async () => {
    mocks.query.mockResolvedValueOnce([]);

    await completeIdempotency(tenant, "key-1", 201, { ok: true }, "lease-1");

    const [query, values] = mocks.query.mock.calls[0]! as [string, unknown[]];
    expect(query).toContain("lease_token = NULL, lease_expires_at = NULL");
    expect(query).toContain("status_code = 0 AND lease_token =");
    expect(values).toContain("lease-1");
  });
});
