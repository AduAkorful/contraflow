import Link from "next/link";
import { SiteNav } from "../../../components/site-nav";
import { SiteFooter } from "../../../components/site-footer";
import { getSession } from "../../../src/session/getSession";
import { listMine } from "../../../src/obligations/service";
import { certificateService } from "../../../src/obligations/certificateDefaults";
import { CertificatesPanel } from "./CertificatesPanel";
import { ObligationsList } from "./ObligationsList";

export default async function ObligationsPage() {
  const session = await getSession();
  // Certificates first: listing them brings any the ledger has applied up to date, so the
  // obligations below show their current remaining amounts.
  const certificates = session ? await certificateService().listCertificates(session.address) : null;
  const result = session ? await listMine(session.address) : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-2xl px-6 py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-serif-display text-4xl leading-[1.05]">Offchain obligations</h1>
            {session && (
              <Link href="/app/obligations/new" className="text-sm text-gold hover:underline">
                Record an obligation →
              </Link>
            )}
          </div>
          <p className="mt-4 text-sm text-muted">
            Debts you and a counterparty have both signed, in any currency. Each one is shown only to its two parties.
            When they form a loop, one certificate signed by everyone in it nets the same amount off each.
          </p>

          {!session && (
            <div className="mt-8 rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
              <p className="text-sm text-muted">Sign in with your wallet to see your obligations.</p>
              <Link href="/app" className="mt-3 inline-block text-sm text-gold hover:underline">
                Go to sign in →
              </Link>
            </div>
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
          {result && result.ok && result.obligations.length > 0 && certificates && certificates.ok && (
            <CertificatesPanel certificates={certificates.certificates} />
          )}
          {result && result.ok && <ObligationsList proposals={result.proposals} obligations={result.obligations} />}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
