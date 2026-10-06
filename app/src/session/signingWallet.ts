/// Which wallet must sign the Contraflow SIWE message after a Privy login.
///
/// Email (and other non-wallet) logins create a Privy embedded wallet. If an injected wallet such
/// as MetaMask is also present, wagmi's active account is often that injected wallet — signing
/// with it would bind the session to the wrong address. Wallet logins (`siwe`) bind the wallet
/// that actually logged in.

export function isEmbeddedWalletClient(walletClientType: string | undefined | null): boolean {
  return walletClientType === "privy" || walletClientType === "privy-v2";
}

/// Privy reports a connected wallet login as `siwe`. Everything else that can create an embedded
/// wallet (email, SMS, passkey, OAuth) must sign with that embedded wallet.
export function loginCreatesEmbeddedWallet(loginMethod: string | null | undefined): boolean {
  if (loginMethod == null || loginMethod === "") return false;
  return loginMethod !== "siwe" && loginMethod !== "siws";
}

export interface WalletCandidate {
  address: string;
  walletClientType: string;
}

export type PickSigningWalletResult =
  | { ok: true; address: string; walletClientType: string; kind: "embedded" | "external" }
  | { ok: false; error: string; missingEmbedded: boolean };

export function pickSigningWallet(params: {
  loginMethod: string | null | undefined;
  wallets: readonly WalletCandidate[];
  loginAccountAddress?: string | null;
}): PickSigningWalletResult {
  const embedded = params.wallets.filter((w) => isEmbeddedWalletClient(w.walletClientType));
  const external = params.wallets.filter((w) => !isEmbeddedWalletClient(w.walletClientType));

  if (loginCreatesEmbeddedWallet(params.loginMethod)) {
    const chosen = embedded[0];
    if (!chosen) {
      return {
        ok: false,
        error: "Your account wallet isn't ready yet. Try again in a moment.",
        missingEmbedded: true,
      };
    }
    return { ok: true, address: chosen.address, walletClientType: chosen.walletClientType, kind: "embedded" };
  }

  const wanted = params.loginAccountAddress?.toLowerCase();
  if (wanted) {
    const match =
      params.wallets.find((w) => w.address.toLowerCase() === wanted) ??
      external.find((w) => w.address.toLowerCase() === wanted);
    if (match) {
      return {
        ok: true,
        address: match.address,
        walletClientType: match.walletClientType,
        kind: isEmbeddedWalletClient(match.walletClientType) ? "embedded" : "external",
      };
    }
  }

  if (external[0]) {
    return {
      ok: true,
      address: external[0].address,
      walletClientType: external[0].walletClientType,
      kind: "external",
    };
  }

  if (embedded[0]) {
    return {
      ok: true,
      address: embedded[0].address,
      walletClientType: embedded[0].walletClientType,
      kind: "embedded",
    };
  }

  return { ok: false, error: "No wallet is connected. Sign in again.", missingEmbedded: false };
}
