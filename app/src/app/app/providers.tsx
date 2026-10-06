"use client";

/// Privy/wagmi provider, scoped to `/app/*` only via `app/src/app/app/layout.tsx` — the marketing
/// pages never load any wallet code. Privy supplies the connect surface (external wallets *and*
/// email-based embedded wallets in one hosted modal) as a wagmi connector source, via
/// `@privy-io/wagmi`'s own `createConfig`/`WagmiProvider` (a drop-in replacement for wagmi's own,
/// required for Privy's connectors to register) — everything downstream (`useAccount`,
/// `useSignMessage`, `useSignTypedData` in compose/landing flows) is unchanged, since it only
/// depends on the wagmi hook contract, not on where the connector came from.

import { QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { SignInProvider } from "@/components/wallet/SignInProvider";
import { arcTestnet } from "@/src/chain/client";
import { ARC_TESTNET_CHAIN_ID } from "@/src/contracts/addresses";
import { gatewaySourceChains, unifiedBalanceEnabled, viemChainFor } from "@/src/kits/gatewayChains";
import { queryClient } from "@/src/query/client";

const wagmiConfig = createConfig({
  chains: [arcTestnet],
  transports: { [arcTestnet.id]: http() },
  ssr: true,
});

/// Privy's embedded wallet can only switch to chains listed here, and "Bring USDC from another
/// chain" deposits from the user's wallet on a source chain. wagmi's own config stays Arc-only, so
/// every other flow is unchanged.
const privyChains = [
  arcTestnet,
  ...(unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID) ? gatewaySourceChains(ARC_TESTNET_CHAIN_ID).map(viemChainFor) : []),
];

/// `PrivyProvider` throws synchronously (crashing this whole segment) unless `appId` is a
/// 25-character string — checked directly in the compiled SDK
/// (`node_modules/@privy-io/react-auth`), not documented, since real App IDs are always exactly
/// that length. A placeholder of the right *length* passes this check and only fails later,
/// asynchronously and non-fatally, when the SDK can't resolve it against Privy's backend — keeping
/// the page rendering (and the rest of the app usable) until a real App ID is provisioned, matching
/// the "genuinely blocked on an operator-provisioned credential, degrade honestly" pattern this
/// project already used for Circle's UCW App ID.
const PLACEHOLDER_APP_ID = "0000000000000000000000000";

export function Providers({
  children,
  autoStartLogin = false,
}: {
  children: React.ReactNode;
  sessionAddress: string | null;
  autoStartLogin?: boolean;
}) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || PLACEHOLDER_APP_ID}
      config={{
        loginMethodsAndOrder: {
          primary: ["email"],
          overflow: ["detected_wallets", "metamask", "coinbase_wallet", "rainbow", "wallet_connect"],
        },
        appearance: {
          theme: "dark",
          accentColor: "#f5be09",
          logo: <img src="/logo-mark.png" alt="Contraflow" />,
          landingHeader: "Sign in to Contraflow",
          loginMessage: "Continue with email. We create a secure account wallet for you. Or use a crypto wallet.",
          walletList: ["detected_wallets", "metamask", "coinbase_wallet", "rainbow", "wallet_connect"],
        },
        defaultChain: arcTestnet,
        supportedChains: privyChains,
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <SignInProvider autoStartLogin={autoStartLogin}>{children}</SignInProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
