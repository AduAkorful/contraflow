import { SignInGate } from "../../../../components/wallet/SignInGate";
import { getSession } from "../../../../src/session/getSession";
import { ComposeObligation } from "./ComposeObligation";

export const metadata = { title: "Record an obligation" };


export default async function NewObligationPage() {
  const session = await getSession();

  return (
    <>
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="heading-1">Record an offchain obligation</h1>
        <p className="mt-4 max-w-xl text-sm text-muted">
          A debt in any currency that&apos;s paid outside Contraflow. You and your counterparty both sign it, so
          it can later be netted against other obligations in a loop. Nothing is recorded until they sign too.
        </p>

        {session ? (
          <div className="mt-8">
            <ComposeObligation signerAddress={session.address} />
          </div>
        ) : (
          <SignInGate title="Sign in to continue" reason="Sign in with your email or wallet first." />
        )}
      </section>
    </>
  );
}
