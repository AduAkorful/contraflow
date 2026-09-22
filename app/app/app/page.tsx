import Link from "next/link";
import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";
import { ConnectButton } from "../../components/wallet/ConnectButton";

export default function AppLandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
          <h1 className="font-serif-display text-4xl leading-[1.05]">Sign in with your wallet</h1>
          <p className="mt-6 max-w-md text-muted">
            Connecting and signing in is real — your wallet proves who you are, nothing is typed or
            trusted from a form. Once you&apos;re signed in, propose a real invoice to a counterparty
            whose address you already know — nothing is registered until they sign too.
          </p>
          <div className="mt-8">
            <ConnectButton
              signedInExtra={
                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
                  <Link href="/app/attest" className="text-gold hover:underline">
                    Propose an invoice →
                  </Link>
                  <Link href="/app/history" className="text-muted hover:underline">
                    View invoice history →
                  </Link>
                </div>
              }
            />
          </div>
          <Link href="/app/demo" className="mt-8 text-sm text-gold hover:underline">
            Try the live demo →
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
