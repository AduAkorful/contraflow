import { AppShell } from "../../components/app-shell/AppShell";
import { ARC_TESTNET_CHAIN_ID } from "../../src/contracts/addresses";
import { unifiedBalanceEnabled } from "../../src/kits/gatewayChains";
import { getSession } from "../../src/session/getSession";
import { docsUrl } from "../../src/site/docsUrl";
import { Providers } from "./providers";

/// `PrivyProvider` validates its `appId` synchronously on init and throws on an invalid one — a
/// real problem only during static prerendering (which runs at build time, before a real App ID
/// necessarily exists yet), not at runtime in the browser. This whole segment is wallet-interactive
/// client UI anyway, so there's nothing worth prerendering statically here.
export const dynamic = "force-dynamic";

export default async function AppSectionLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <Providers sessionAddress={session?.address ?? null}>
      <AppShell address={session?.address ?? null} balanceEnabled={unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID)} docsUrl={docsUrl()}>
        {children}
      </AppShell>
    </Providers>
  );
}
