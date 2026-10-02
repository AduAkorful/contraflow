import { beforeEach, describe, expect, it, vi } from "vitest";

const evalScript = vi.fn();
const get = vi.fn();
const set = vi.fn();
vi.mock("../src/upstash/client", () => ({
  redis: () => ({ eval: evalScript, get, set }),
}));

const {
  claimDemoSpend,
  completeDemoSpend,
  demoSpendCostMicroUsdc,
  DEMO_REGISTER_TRANSACTION_LIMITS,
  DEMO_SETTLE_TRANSACTION_LIMITS,
  DEMO_DAILY_BUDGET_MICRO_USDC,
  inspectDemoSpend,
} = await import("../src/demo/spendBudget");

describe("demo operator spend budget", () => {
  beforeEach(() => {
    evalScript.mockReset();
    get.mockReset();
    set.mockReset();
  });

  it("reserves the exact worst-case gas ceiling in micro-USDC", () => {
    expect(DEMO_DAILY_BUDGET_MICRO_USDC).toBe(2_000_000);
    expect(demoSpendCostMicroUsdc(DEMO_REGISTER_TRANSACTION_LIMITS)).toBe(50_000);
    expect(demoSpendCostMicroUsdc(DEMO_SETTLE_TRANSACTION_LIMITS)).toBe(100_000);
  });

  it("atomically asks Redis to deduplicate, rate-limit, and reserve the daily budget", async () => {
    evalScript.mockResolvedValueOnce('{"status":"reserved"}');
    const result = await claimDemoSpend({
      operationId: "register:3:0:run-salt",
      callerIp: "203.0.113.4",
      limits: DEMO_REGISTER_TRANSACTION_LIMITS,
      now: new Date("2026-10-02T12:00:00.000Z"),
    });

    expect(result).toMatchObject({ kind: "reserved" });
    expect(evalScript).toHaveBeenCalledOnce();
    const [script, keys, args] = evalScript.mock.calls[0]!;
    expect(script).toContain("redis.call('SET', KEYS[1], 'pending')");
    expect(script).toContain("current + cost > tonumber(ARGV[2])");
    expect(keys).toHaveLength(3);
    expect(keys[0]).not.toContain("run-salt");
    expect(keys[1]).not.toContain("203.0.113.4");
    expect(args.slice(0, 3)).toEqual(["50000", "2000000", "30"]);
  });

  it("returns the prior result without authorizing a second reservation", async () => {
    const prior = { ok: true, invoice: { txHash: "0xconfirmed" } };
    evalScript.mockResolvedValueOnce(JSON.stringify({
      status: "existing",
      value: JSON.stringify({ status: "complete", result: prior }),
    }));

    await expect(claimDemoSpend({
      operationId: "register:3:0:run-salt",
      callerIp: "203.0.113.4",
      limits: DEMO_REGISTER_TRANSACTION_LIMITS,
    })).resolves.toEqual({ kind: "complete", result: prior });
  });

  it("keeps ambiguous operations pending and stores successful results", async () => {
    get.mockResolvedValueOnce("pending");
    await expect(inspectDemoSpend("settle:cycle")).resolves.toEqual({ kind: "pending" });

    get.mockResolvedValueOnce(null);
    await expect(inspectDemoSpend("settle:new-cycle")).resolves.toEqual({ kind: "available" });

    set.mockResolvedValueOnce("OK");
    await completeDemoSpend("demo:operation:hash", { ok: true, result: { txHash: "0xconfirmed" } });
    expect(set).toHaveBeenCalledWith(
      "demo:operation:hash",
      JSON.stringify({ status: "complete", result: { ok: true, result: { txHash: "0xconfirmed" } } }),
    );
  });

  it("fails closed when Redis is unavailable or returns an invalid result", async () => {
    evalScript.mockRejectedValueOnce(new Error("redis unavailable"));
    await expect(claimDemoSpend({
      operationId: "settle:cycle",
      callerIp: "unknown",
      limits: DEMO_SETTLE_TRANSACTION_LIMITS,
    })).resolves.toEqual({ kind: "unavailable" });

    evalScript.mockResolvedValueOnce("not-json");
    await expect(claimDemoSpend({
      operationId: "settle:cycle-2",
      callerIp: "unknown",
      limits: DEMO_SETTLE_TRANSACTION_LIMITS,
    })).resolves.toEqual({ kind: "unavailable" });
  });
});
