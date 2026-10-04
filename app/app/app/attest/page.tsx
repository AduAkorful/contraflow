import { SignInGate } from "../../../components/wallet/SignInGate";
import { getSession } from "../../../src/session/getSession";
import { ComposeForm } from "./ComposeForm";

export const metadata = { title: "Propose an invoice" };


export default async function AttestComposePage() {
  const session = await getSession();

  return (
    <>
      <section className="mx-auto max-w-xl px-6 py-16">
        <h1 className="heading-1">Propose an invoice</h1>
        <p className="mt-4 text-sm text-muted">
          Sign a USDC invoice with your wallet and send your counterparty the link. Nothing is
          registered on Arc until they sign too.
        </p>

        {session ? (
          <div className="mt-8">
            <ComposeForm signerAddress={session.address} />
          </div>
        ) : (
          <SignInGate returnTo="/app/attest" message="Sign in with your wallet first." />
        )}
      </section>
    </>
  );
}
