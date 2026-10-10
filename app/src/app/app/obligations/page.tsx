import Link from "next/link";
import { SignInGate } from "@/components/wallet/SignInGate";
import { SessionBound } from "@/components/session/SessionProvider";
import { getSession } from "@/src/session/getSession";
import { listMine } from "@/src/obligations/service";
import { obligationPositionByCurrency, obligationPositionLine } from "@/src/obligations/position";
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

  const position = result && result.ok ? obligationPositionByCurrency(result.obligations) : [];

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="heading-1">Offchain obligations</h1>
        {session && (
          <Link
            href="/app/obligations/new"
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-black hover:scale-[1.02]"
          >
            Record a debt
          </Link>
        )}
      </div>

      {!session && (
        <>
          <p className="mt-4 max-w-2xl text-sm text-muted">
            Debts you and a counterparty have both signed, in any currency, netted with a certificate everyone in the
            loop signs.
          </p>
          <SignInGate title="Sign in to continue" reason="Sign in with your email or wallet to see your obligations." />
        </>
      )}

      {session && (
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            {result && !result.ok && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{result.error}</p>
            )}
            {result && result.ok && (
              <SessionBound loadedFor={session.address}>
                <ObligationsList proposals={result.proposals} obligations={result.obligations} />
              </SessionBound>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
            <div className="rounded-card border border-border-subtle bg-surface-1 p-5">
              <h2 className="text-xs uppercase tracking-wide text-muted">Your position</h2>
              {position.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Nothing recorded yet.</p>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  {position.map((row) => (
                    <p key={row.currency}>{obligationPositionLine(row)}</p>
                  ))}
                </div>
              )}
            </div>

            {certificates && !certificates.ok && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {certificates.error}
              </p>
            )}
            {result && result.ok && result.obligations.length > 0 && certificates && certificates.ok && (
              <SessionBound loadedFor={session.address}>
                <CertificatesPanel certificates={certificates.certificates} />
              </SessionBound>
            )}

            <div className="rounded-card border border-border-subtle bg-surface-1 p-5 text-sm text-muted">
              <h2 className="text-xs uppercase tracking-wide">How it works</h2>
              <p className="mt-3">
                Each obligation&apos;s terms are shown only to its two parties. Everyone in a loop sees the addresses in
                it. When debts form a loop, one certificate signed by everyone in it nets the same amount off each.
              </p>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
