"use client";

/// Wagmi/wallet-connect provider, scoped to `/app/*` only via `app/app/app/layout.tsx` — the
/// marketing pages never load any wallet code. Injected connector only (browser-extension
/// wallets: MetaMask, Rabby, Coinbase Wallet extension, etc.) — WalletConnect/RainbowKit are out
/// of scope.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, injected } from "wagmi";
import { arcTestnet } from "../../src/chain/client";

const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http() },
  // Without this, wagmi's default reconnect-on-mount can race the persisted connection state
  // loading from localStorage on a fresh page load — it silently fails to restore the wallet
  // connection with no retry, leaving `isConnected` stuck false even with a valid signed-in
  // session (the bug behind ComposeForm's "Reconnect your wallet to continue" dead end).
  ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
