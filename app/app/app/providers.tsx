"use client";

/// Privy/wagmi provider, scoped to `/app/*` only via `app/app/app/layout.tsx` — the marketing
/// pages never load any wallet code. Privy supplies the connect surface (external wallets *and*
/// email-based embedded wallets in one hosted modal) as a wagmi connector source, via
/// `@privy-io/wagmi`'s own `createConfig`/`WagmiProvider` (a drop-in replacement for wagmi's own,
/// required for Privy's connectors to register) — everything downstream (`useAccount`,
/// `useSignMessage`, `useSignTypedData` in `ConnectButton`/`ComposeForm`/`LandingClient`) is
/// unchanged, since it only depends on the wagmi hook contract, not on where the connector came
/// from.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { arcTestnet } from "../../src/chain/client";

const wagmiConfig = createConfig({
  chains: [arcTestnet],
  transports: { [arcTestnet.id]: http() },
  ssr: true,
});

const queryClient = new QueryClient();

/// `PrivyProvider` throws synchronously (crashing this whole segment) unless `appId` is a
/// 25-character string — checked directly in the compiled SDK
/// (`node_modules/@privy-io/react-auth`), not documented, since real App IDs are always exactly
/// that length. A placeholder of the right *length* passes this check and only fails later,
/// asynchronously and non-fatally, when the SDK can't resolve it against Privy's backend — keeping
/// the page rendering (and the rest of the app usable) until a real App ID is provisioned, matching
/// the "genuinely blocked on an operator-provisioned credential, degrade honestly" pattern this
/// project already used for Circle's UCW App ID.
const PLACEHOLDER_APP_ID = "0000000000000000000000000";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || PLACEHOLDER_APP_ID}
      config={{
        loginMethods: ["wallet", "email"],
        appearance: { theme: "dark" },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
