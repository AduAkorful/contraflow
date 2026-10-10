import { isAddress } from "viem";
import { SignInGate } from "@/components/wallet/SignInGate";
import { getSession } from "@/src/session/getSession";
import { APP_CHAIN_ID } from "@/src/contracts/addresses";
import { chainById } from "@/src/chain/client";
import { unifiedBalanceEnabled } from "@/src/kits/gatewayChains";
import { BalanceClient } from "./BalanceClient";
import { pageMeta } from "@/src/site/pageMeta";

export const metadata = pageMeta(
  "/app/balance",
  "Balance",
  "Send USDC from your wallet on Arc, or bring USDC from another chain. Contraflow never holds the funds.",
);

/// The server only decides who's signed in and which tabs exist. Balances, deposits, moves and sends
/// all run in the browser, between the user's own wallet, Circle and Arc.
export default async function BalancePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; to?: string | string[] }> }) {
  const session = await getSession();
  const params = await searchParams;
  const gatewayEnabled = unifiedBalanceEnabled(APP_CHAIN_ID);
  const requestedTab = typeof params.tab === "string" ? params.tab : "";
  const initialTab = requestedTab === "send" || !gatewayEnabled ? "send" : requestedTab === "move" ? "move" : "deposit";
  const to = typeof params.to === "string" && isAddress(params.to.trim(), { strict: false }) ? params.to.trim() : "";

  return (
    <section className="mx-auto max-w-[30rem] px-4 py-12 sm:px-0">
      <h1 className="heading-1">Balance</h1>
      <p className="mt-4 text-sm text-muted">
        {gatewayEnabled
          ? "Send USDC from your wallet on Arc, or bring USDC from another chain. Your wallet signs every step, and Contraflow never holds the funds."
          : "Send USDC from your wallet on Arc. Your wallet signs it and pays the network fee, and Contraflow never holds the funds."}
      </p>

      {session ? (
        <BalanceClient
          owner={session.address as `0x${string}`}
          arcChainId={APP_CHAIN_ID}
          chainName={chainById(APP_CHAIN_ID).name}
          gatewayEnabled={gatewayEnabled}
          initialTab={initialTab}
          initialTo={to}
        />
      ) : (
        <SignInGate title="Sign in to continue" reason="Sign in with your email or wallet to see your balance." />
      )}
    </section>
  );
}
