"use client";

import { useAccount } from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import { isAddressEqual, numberToHex, type EIP1193Provider } from "viem";

import { userAdapter, type UserAdapter } from "@/src/kits/browserAdapter";
import type { GatewayChain } from "@/src/kits/gatewayChains";

export type WalletState =
  | { status: "disconnected" }
  /// The session's own Privy (email) wallet exists but wagmi isn't pointed at it yet. The page makes
  /// it the active wallet; until then deposit and move use its provider directly.
  | { status: "mismatch"; connected: `0x${string}` }
  | {
      status: "ready";
      adapter: () => Promise<UserAdapter>;
      switchTo: (chain: GatewayChain) => Promise<void>;
      returnTo: (chainId: number) => Promise<void>;
    };

/// The connected wallet may act only when it is the signed-in address. Nothing is ever signed
/// for a different account than the session's.
export function useOwnerWallet(owner: `0x${string}`): WalletState {
  const { address, isConnected, connector } = useAccount();
  const { wallets } = useWallets();
  const wagmiIsOwner = Boolean(isConnected && address && connector && isAddressEqual(address, owner));
  // An email account signs with its Privy embedded wallet. wagmi only follows it once it is the
  // active wallet, which a reload or a Privy re-login doesn't always restore, so fall back to the
  // Privy wallet for the session's own address rather than asking for an outside wallet.
  const ownWallet = wagmiIsOwner
    ? undefined
    : wallets.find((w) => w.walletClientType?.startsWith("privy") && isAddressEqual(w.address as `0x${string}`, owner));
  if (!wagmiIsOwner && !ownWallet) {
    if (!isConnected || !address || !connector) return { status: "disconnected" };
    return { status: "mismatch", connected: address };
  }

  const provider = async () =>
    (ownWallet ? await ownWallet.getEthereumProvider() : await connector!.getProvider()) as EIP1193Provider;
  return {
    status: "ready",
    adapter: async () => userAdapter(await provider()),
    // App Kit signs a deposit's USDC authorization before it switches networks itself, and wallets
    // such as MetaMask refuse typed data for a chain other than the active one. So the wallet is
    // moved to the source chain first, adding the chain if the wallet doesn't know it yet.
    switchTo: async (chain) => {
      const p = await provider();
      const chainId = numberToHex(chain.chainId);
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
      } catch (error) {
        if ((error as { code?: unknown })?.code !== 4902) throw error;
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId,
              chainName: chain.name,
              nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: chain.nativeDecimals },
              rpcUrls: [chain.rpcUrl],
              blockExplorerUrls: [new URL(chain.explorerTxUrl.replace("{hash}", "")).origin],
            },
          ],
        });
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
      }
    },
    // Deposits leave the wallet on the source chain. Other Contraflow flows sign for Arc, and some
    // wallets refuse to sign typed data for a chain they aren't on, so switch back afterwards.
    returnTo: async (chainId) => {
      try {
        await (await provider()).request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chainId) }] });
      } catch {
        // Best effort: the user can switch in their wallet, and every Contraflow signing flow
        // reports a wrong-network error plainly.
      }
    },
  };
}

/// A plain sentence for a wallet or Circle error, never a raw stack.
export function walletErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === 4001 || /user (rejected|denied)|rejected the request|cancell?ed/i.test(message)) {
    return "You cancelled in your wallet. Nothing was sent.";
  }
  if (/insufficient funds|exceeds balance|not enough/i.test(message)) {
    return "Your wallet doesn't hold enough for this, including the network fee.";
  }
  if (/switch|unrecognized chain|unsupported chain/i.test(message)) {
    return "Your wallet couldn't switch to that network. Switch to it in your wallet and try again.";
  }
  return "Circle couldn't complete this right now. Your balances below show where your USDC is.";
}
