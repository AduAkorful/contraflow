import { notFound } from "next/navigation";
import { SignInGate } from "@/components/wallet/SignInGate";
import { getSession } from "@/src/session/getSession";
import { ARC_TESTNET_CHAIN_ID } from "@/src/contracts/addresses";
import { unifiedBalanceEnabled } from "@/src/kits/gatewayChains";
import { BalanceClient } from "./BalanceClient";
import { pageMeta } from "@/src/site/pageMeta";

export const metadata = pageMeta(
  "/app/balance",
  "Bring USDC from another chain",
  "Move USDC from another chain to your own Arc address. Contraflow never holds the funds.",
);


/// The server only decides who's signed in. Balances, deposits and moves all run in the browser,
/// between the user's own wallet and Circle.
export default async function BalancePage() {
  if (!unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID)) notFound();
  const session = await getSession();

  return (
    <>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="heading-1">Bring USDC from another chain</h1>
        <p className="mt-4 text-sm text-muted">
          Deposit USDC from your wallet on another chain into Circle Gateway, then move it to your own wallet on
          Arc. Your wallet signs every step, and the funds only ever go to your own address.
        </p>

        {session ? (
          <BalanceClient owner={session.address as `0x${string}`} arcChainId={ARC_TESTNET_CHAIN_ID} />
        ) : (
          <SignInGate title="Sign in to continue" reason="Sign in with your email or wallet to see your balance." />
        )}
      </section>
    </>
  );
}
