import { describe, expect, it } from "vitest";
import { ownPrivyWallet } from "../src/app/app/balance/wallet";

const OWNER = "0xe2c4000000000000000000000000000000003e38" as const;
const OTHER = "0x1111111111111111111111111111111111111111";

describe("ownPrivyWallet", () => {
  it("finds an extension wallet for the signed-in address, not only an embedded one", () => {
    const wallets = [{ address: OTHER, walletClientType: "metamask" }, { address: OWNER, walletClientType: "metamask" }];
    expect(ownPrivyWallet(wallets, OWNER)).toBe(wallets[1]);
  });

  it("prefers the embedded wallet when the same address has both", () => {
    const wallets = [{ address: OWNER, walletClientType: "metamask" }, { address: OWNER, walletClientType: "privy" }];
    expect(ownPrivyWallet(wallets, OWNER)).toBe(wallets[1]);
  });

  it("never returns a wallet for a different address", () => {
    expect(ownPrivyWallet([{ address: OTHER, walletClientType: "privy" }], OWNER)).toBeUndefined();
  });

  it("matches the address regardless of letter case", () => {
    const wallets = [{ address: OWNER.toUpperCase().replace("0X", "0x"), walletClientType: "metamask" }];
    expect(ownPrivyWallet(wallets, OWNER)).toBe(wallets[0]);
  });
});
