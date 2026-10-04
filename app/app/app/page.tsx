import Link from "next/link";
import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";
import { ConnectButton } from "../../components/wallet/ConnectButton";
import { ProtocolStats } from "../../components/stats/ProtocolStats";
import { ARC_TESTNET_CHAIN_ID } from "../../src/contracts/addresses";
import { unifiedBalanceEnabled } from "../../src/kits/gatewayChains";

export const metadata = { title: "Sign in" };


export default function AppLandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
          <h1 className="heading-1">Sign in with your wallet</h1>
          <p className="mt-6 max-w-md text-muted">
            Sign in with your wallet or your email, then record a debt with a counterparty: a USDC
            invoice on Arc, or an obligation in any currency. Nothing is recorded until they sign too.
          </p>
          <div className="mt-8">
            <ConnectButton
              signedInExtra={
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
                  <Link href="/app/attest" className="text-gold hover:underline">
                    Propose a USDC invoice →
                  </Link>
                  <Link href="/app/obligations" className="text-gold hover:underline">
                    Obligations in any currency →
                  </Link>
                  <Link href="/app/history" className="text-muted hover:underline">
                    Invoice history →
                  </Link>
                  {unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID) && (
                    <Link href="/app/balance" className="text-muted hover:underline">
                      Bring USDC from another chain →
                    </Link>
                  )}
                </div>
              }
            />
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <Link href="/app/demo" className="text-gold hover:underline">
              Try the live demo →
            </Link>
            <Link href="/app/verify" className="text-muted hover:underline">
              Verify a certificate →
            </Link>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-6 pb-24" aria-labelledby="protocol-stats-heading">
          <h2 id="protocol-stats-heading" className="mb-6 text-sm font-medium">
            Protocol activity
          </h2>
          <ProtocolStats variant="full" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
