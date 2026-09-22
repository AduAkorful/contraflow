import { SiteNav } from "../../../../components/site-nav";
import { SiteFooter } from "../../../../components/site-footer";
import { Receipt } from "../../../../components/receipt/Receipt";
import { getReceiptData } from "../../../../src/receipt/getReceiptData";

/// DB-first, Blockscout-fallback receipt page. Works for any settle() tx hash on this
/// deployment, not just ones `/app/demo` itself produced:
/// register()/settle() are permissionless, so a tx this app never saw still renders correctly via
/// the Blockscout fallback in `getReceiptData`.
export default async function ReceiptPage({ params }: { params: Promise<{ txHash: string }> }) {
  const { txHash } = await params;
  const data = await getReceiptData(txHash);

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-2xl px-6 py-16">
          {data ? (
            <Receipt data={data} />
          ) : (
            <div className="rounded-card border border-white/10 bg-white/[0.02] p-8 text-center">
              <h1 className="font-serif-display text-2xl">No settlement found</h1>
              <p className="mt-3 text-sm text-muted">
                <span className="font-mono">{txHash}</span> isn&apos;t a settle() transaction on Arc
                testnet, or the transaction is too new for the explorer to have indexed yet.
              </p>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
