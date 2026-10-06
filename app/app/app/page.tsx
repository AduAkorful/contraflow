import Link from "next/link";
import { redirect } from "next/navigation";
import { Overview } from "./Overview";
import { SignInRedirect } from "../../components/wallet/SignInRedirect";
import { ProtocolStats } from "../../components/stats/ProtocolStats";
import { getSession } from "../../src/session/getSession";
import { safeNextPath } from "../../src/session/nextPath";

export async function generateMetadata() {
  return { title: (await getSession()) ? "Overview" : "Sign in" };
}

export default async function AppLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; switch?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const autoStart = params.switch === "1";
  const session = await getSession();
  // Someone already signed in who followed a sign-in link just continues.
  if (session && next) redirect(next);

  const stats = (
    <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6" aria-labelledby="protocol-stats-heading">
      <h2 id="protocol-stats-heading" className="mb-6 text-sm font-medium">
        Protocol activity
      </h2>
      <ProtocolStats variant="full" />
    </section>
  );

  if (session) {
    return (
      <>
        <Overview address={session.address} />
        <div className="mt-10">{stats}</div>
      </>
    );
  }

  return (
    <>
      <section className="mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
        <h1 className="heading-1">Sign in to Contraflow</h1>
        <p className="mt-6 max-w-md text-muted">
          Sign in with your email or a wallet, then record a debt with a counterparty: a USDC invoice on Arc, or an
          obligation in any currency. Nothing is recorded until they sign too.
        </p>
        <div className="mt-8">
          <SignInRedirect next={next} autoStart={autoStart} />
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
    </>
  );
}
