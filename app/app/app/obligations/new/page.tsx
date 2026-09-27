import Link from "next/link";
import { SiteNav } from "../../../../components/site-nav";
import { SiteFooter } from "../../../../components/site-footer";
import { getSession } from "../../../../src/session/getSession";
import { ComposeObligation } from "./ComposeObligation";

export default async function NewObligationPage() {
  const session = await getSession();

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-xl px-6 py-16">
          <h1 className="font-serif-display text-3xl leading-[1.05]">Record an offchain obligation</h1>
          <p className="mt-4 text-sm text-muted">
            A debt in any currency that&apos;s paid outside Contraflow. You and your counterparty both sign it, so
            it can later be netted against other obligations in a loop. Nothing is recorded until they sign too.
          </p>

          {session ? (
            <div className="mt-8">
              <ComposeObligation signerAddress={session.address} />
            </div>
          ) : (
            <div className="mt-8 rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
              <p className="text-sm text-muted">Sign in with your wallet first.</p>
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
