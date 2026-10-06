import { AppShell } from "@/components/app-shell/AppShell";
import { SessionProvider } from "@/components/session/SessionProvider";
import { WalletHost } from "@/components/wallet/WalletHost";
import { ARC_TESTNET_CHAIN_ID } from "@/src/contracts/addresses";
import { unifiedBalanceEnabled } from "@/src/kits/gatewayChains";
import { getSession } from "@/src/session/getSession";
import { docsNavLink } from "@/src/site/docsUrl";

/// `PrivyProvider` validates its `appId` synchronously on init and throws on an invalid one — a
/// real problem only during static prerendering (which runs at build time, before a real App ID
/// necessarily exists yet), not at runtime in the browser. This whole segment is wallet-interactive
/// client UI anyway, so there's nothing worth prerendering statically here.
export const dynamic = "force-dynamic";

export default async function AppSectionLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const address = session?.address ?? null;
  return (
    <SessionProvider initialAddress={address}>
      <WalletHost hasSession={address !== null} sessionAddress={address}>
        <AppShell address={address} balanceEnabled={unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID)} docs={docsNavLink()}>
          {children}
        </AppShell>
      </WalletHost>
    </SessionProvider>
  );
}
