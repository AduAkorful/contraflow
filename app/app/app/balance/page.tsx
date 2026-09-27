import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "../../../components/site-nav";
import { SiteFooter } from "../../../components/site-footer";
import { getSession } from "../../../src/session/getSession";
import { ARC_TESTNET_CHAIN_ID } from "../../../src/contracts/addresses";
import { unifiedBalanceEnabled } from "../../../src/kits/gatewayChains";
import { BalanceClient } from "./BalanceClient";

/// The server only decides who's signed in. Balances, deposits and moves all run in the browser,
/// between the user's own wallet and Circle.
export default async function BalancePage() {
  if (!unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID)) notFound();
  const session = await getSession();

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="font-serif-display text-4xl leading-[1.05]">Bring USDC from another chain</h1>
          <p className="mt-4 text-sm text-muted">
            Deposit USDC from your wallet on another chain into Circle Gateway, then move it to your own wallet on
            Arc. Your wallet signs every step, and the funds only ever go to your own address.
          </p>

          {session ? (
            <BalanceClient owner={session.address as `0x${string}`} arcChainId={ARC_TESTNET_CHAIN_ID} />
          ) : (
            <div className="mt-8 rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
              <p className="text-sm text-muted">Sign in with your wallet to see your balance.</p>
              <Link href="/app" className="mt-3 inline-block text-sm text-gold hover:underline">
                Go to sign in →
              </Link>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
