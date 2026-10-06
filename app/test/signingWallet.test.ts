import { describe, expect, it } from "vitest";
import { loginCreatesEmbeddedWallet, pickSigningWallet } from "../src/session/signingWallet";

const privy = { address: "0x1111111111111111111111111111111111111111", walletClientType: "privy" };
const metamask = { address: "0x2222222222222222222222222222222222222222", walletClientType: "metamask" };

describe("pickSigningWallet", () => {
  it("picks the Privy embedded wallet for an email login even when MetaMask is injected", () => {
    const picked = pickSigningWallet({ loginMethod: "email", wallets: [metamask, privy] });
    expect(picked).toEqual({ ok: true, address: privy.address, walletClientType: "privy", kind: "embedded" });
  });

  it("picks the wallet that logged in for a wallet login", () => {
    const picked = pickSigningWallet({
      loginMethod: "siwe",
      wallets: [privy, metamask],
      loginAccountAddress: metamask.address,
    });
    expect(picked).toEqual({ ok: true, address: metamask.address, walletClientType: "metamask", kind: "external" });
  });

  it("asks for an embedded wallet to be created when email login has none yet", () => {
    const picked = pickSigningWallet({ loginMethod: "email", wallets: [metamask] });
    expect(picked).toEqual({
      ok: false,
      missingEmbedded: true,
      error: "Your account wallet isn't ready yet. Try again in a moment.",
    });
  });
});

describe("loginCreatesEmbeddedWallet", () => {
  it("treats email as embedded and siwe as the connected wallet", () => {
    expect(loginCreatesEmbeddedWallet("email")).toBe(true);
    expect(loginCreatesEmbeddedWallet("siwe")).toBe(false);
    expect(loginCreatesEmbeddedWallet("google")).toBe(true);
  });
});
