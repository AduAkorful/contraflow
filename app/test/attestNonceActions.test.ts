import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveNextNonce: vi.fn(), getSession: vi.fn(), guardPublicRead: vi.fn() }));
vi.mock("../src/attest/nextNonce", () => ({ resolveNextNonce: mocks.resolveNextNonce }));
vi.mock("../src/session/getSession", () => ({ getSession: mocks.getSession }));
vi.mock("../src/ratelimit/publicReadGuard", () => ({ guardPublicRead: mocks.guardPublicRead }));
vi.mock("../src/attest/precheck", () => ({ preCheckAttestation: vi.fn() }));
vi.mock("../src/attest/record", () => ({ recordRegistration: vi.fn() }));
vi.mock("../src/db/documents", () => ({ insertInvoiceDocumentIfAbsent: vi.fn(), getInvoiceDocumentByRef: vi.fn() }));
vi.mock("../src/attest/invoiceLinks", () => ({ createInvoiceShareLink: vi.fn(), getInvoiceShareLink: vi.fn() }));

const { nextNonceFor, checkLinkFreshness } = await import("../src/app/app/attest/actions");

const A = "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C";
const B = "0xD98CC80747e67B357EA914614C213209c877Be04";

describe("nonce actions when the chain can't be read", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ address: A });
    mocks.guardPublicRead.mockResolvedValue({ allowed: true });
  });

  it("answers a plain message, not a rejection, for the signed-in lookup", async () => {
    mocks.resolveNextNonce.mockRejectedValue(new Error("The chain index is not caught up yet"));
    const result = await nextNonceFor(A, B);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toMatch(/try again/i);
  });

  it("answers a plain message for the link freshness check, never 'fresh'", async () => {
    mocks.resolveNextNonce.mockRejectedValue(new Error("rpc down"));
    const result = await checkLinkFreshness(A, B, "1");
    expect(result).toMatchObject({ ok: false });
  });

  it("still answers normally when the index is up", async () => {
    mocks.resolveNextNonce.mockResolvedValue(3n);
    expect(await nextNonceFor(A, B)).toEqual({ ok: true, nonce: "3" });
    expect(await checkLinkFreshness(A, B, "3")).toEqual({ ok: true, fresh: true, expectedNonce: "3" });
    expect(await checkLinkFreshness(A, B, "2")).toEqual({ ok: true, fresh: false, expectedNonce: "3" });
  });
});
