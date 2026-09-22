import { describe, expect, it, vi, beforeEach } from "vitest";

const createUser = vi.fn();
const createUserToken = vi.fn();
const createUserPinWithWallets = vi.fn();
const signTypedData = vi.fn();

class FakeHttpResponseError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

vi.mock("@circle-fin/user-controlled-wallets", () => ({
  initiateUserControlledWalletsClient: vi.fn(() => ({
    createUser,
    createUserToken,
    createUserPinWithWallets,
    signTypedData,
  })),
  HttpResponseError: FakeHttpResponseError,
}));

process.env.CIRCLE_API_KEY = "test-key";

const { ensureCircleUser, issueUserToken, beginPinAndWalletSetup } = await import("../src/ucw/client");
const { beginSignTypedData } = await import("../src/ucw/signTypedData");

describe("ensureCircleUser", () => {
  beforeEach(() => createUser.mockReset());

  it("succeeds for a genuinely new user", async () => {
    createUser.mockResolvedValueOnce({ data: { id: "u1", status: "ENABLED" } });
    await expect(ensureCircleUser("u1")).resolves.toBeUndefined();
  });

  it("treats a 409 (already exists) as success — confirmed live, not assumed", async () => {
    createUser.mockRejectedValueOnce(new FakeHttpResponseError(409));
    await expect(ensureCircleUser("u1")).resolves.toBeUndefined();
  });

  it("rethrows any other error", async () => {
    createUser.mockRejectedValueOnce(new FakeHttpResponseError(500));
    await expect(ensureCircleUser("u1")).rejects.toThrow();
  });
});

describe("issueUserToken", () => {
  beforeEach(() => createUserToken.mockReset());

  it("returns the real session shape", async () => {
    createUserToken.mockResolvedValueOnce({ data: { userToken: "tok", encryptionKey: "key" } });
    await expect(issueUserToken("u1")).resolves.toEqual({ userToken: "tok", encryptionKey: "key" });
  });

  it("throws if Circle returns an incomplete session", async () => {
    createUserToken.mockResolvedValueOnce({ data: { userToken: "tok" } });
    await expect(issueUserToken("u1")).rejects.toThrow(/incomplete session/);
  });
});

describe("beginPinAndWalletSetup", () => {
  beforeEach(() => createUserPinWithWallets.mockReset());

  it("requests an ARC-TESTNET wallet and returns the challenge id", async () => {
    createUserPinWithWallets.mockResolvedValueOnce({ data: { challengeId: "chal-1" } });
    const result = await beginPinAndWalletSetup("tok");
    expect(result).toEqual({ challengeId: "chal-1" });
    expect(createUserPinWithWallets).toHaveBeenCalledWith({ userToken: "tok", blockchains: ["ARC-TESTNET"] });
  });

  it("throws if Circle returns no challengeId", async () => {
    createUserPinWithWallets.mockResolvedValueOnce({ data: {} });
    await expect(beginPinAndWalletSetup("tok")).rejects.toThrow(/no challengeId/);
  });
});

describe("beginSignTypedData", () => {
  beforeEach(() => signTypedData.mockReset());

  it("serializes typedData to a JSON string and returns the challengeId — not a signature, see the module's own correction note", async () => {
    signTypedData.mockResolvedValueOnce({ data: { challengeId: "chal-sign-1" } });
    const typedData = { domain: {}, types: {}, message: {} };
    const result = await beginSignTypedData({ walletId: "w1", userToken: "tok", typedData });

    expect(result).toEqual({ challengeId: "chal-sign-1" });
    expect(signTypedData).toHaveBeenCalledWith({ walletId: "w1", userToken: "tok", data: JSON.stringify(typedData) });
  });

  it("throws if Circle's response has no challengeId", async () => {
    signTypedData.mockResolvedValueOnce({ data: {} });
    await expect(beginSignTypedData({ walletId: "w1", userToken: "tok", typedData: {} })).rejects.toThrow(/challengeId/);
  });
});
