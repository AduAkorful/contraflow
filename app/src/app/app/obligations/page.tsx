import Link from "next/link";
import { SignInGate } from "@/components/wallet/SignInGate";
import { SessionBound } from "@/components/session/SessionProvider";
import { getSession } from "@/src/session/getSession";
import { listMine } from "@/src/obligations/service";
import { certificateService } from "@/src/obligations/certificateDefaults";
import { CertificatesPanel } from "./CertificatesPanel";
import { ObligationsList } from "./ObligationsList";
import { pageMeta } from "@/src/site/pageMeta";

export const metadata = pageMeta(
  "/app/obligations",
  "Offchain obligations",
  "Debts in any currency, shown to the two parties, netted with a certificate everyone in the loop signs.",
);


export default async function ObligationsPage() {
  const session = await getSession();
  // Certificates first: listing them brings any the ledger has applied up to date, so the
  // obligations below show their current remaining amounts.
  const certificates = session ? await certificateService().listCertificates(session.address) : null;
  const result = session ? await listMine(session.address) : null;

  return (
    <>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="heading-1">Offchain obligations</h1>
          {session && (
            <Link href="/app/obligations/new" className="text-sm text-gold hover:underline">
              Record a debt →
            </Link>
          )}
        </div>
        <p className="mt-4 text-sm text-muted">
          Debts you and a counterparty have both signed, in any currency. Each obligation&apos;s terms are shown only to
          its two parties. Everyone in a loop sees the addresses in it. When they form a loop, one certificate signed by
          everyone in it nets the same amount off each.
        </p>

        {!session && (
          <SignInGate title="Sign in to continue" reason="Sign in with your email or wallet to see your obligations." />
        )}
        {result && !result.ok && (
          <p className="mt-8 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {result.error}
          </p>
        )}
        {certificates && !certificates.ok && (
          <p className="mt-8 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {certificates.error}
          </p>
        )}
        {session && result && result.ok && result.obligations.length > 0 && certificates && certificates.ok && (
          <SessionBound loadedFor={session.address}>
            <CertificatesPanel certificates={certificates.certificates} />
          </SessionBound>
        )}
        {session && result && result.ok && (
          <SessionBound loadedFor={session.address}>
            <ObligationsList proposals={result.proposals} obligations={result.obligations} />
          </SessionBound>
        )}
      </section>
    </>
  );
}
