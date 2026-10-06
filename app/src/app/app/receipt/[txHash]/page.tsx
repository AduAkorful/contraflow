import { Receipt } from "../../../../components/receipt/Receipt";
import { getReceiptData } from "../../../../src/receipt/getReceiptData";
import { CycleSignals } from "./CycleSignals";

export const metadata = { title: "Settlement receipt" };


/// DB-first, Blockscout-fallback receipt page. Works for any settle() tx hash on this
/// deployment, not just ones `/app/demo` itself produced:
/// register()/settle() are permissionless, so a tx this app never saw still renders correctly via
/// the Blockscout fallback in `getReceiptData`.
export default async function ReceiptPage({ params }: { params: Promise<{ txHash: string }> }) {
  const { txHash } = await params;
  const data = await getReceiptData(txHash);

  return (
    <>
      <section className="mx-auto max-w-2xl px-6 py-16">
        {data ? (
          <>
            <Receipt data={data} />
            <CycleSignals txHash={txHash} />
          </>
        ) : (
          <div className="rounded-card border border-border-subtle bg-surface-1 p-8 text-center">
            <h1 className="heading-2">No settlement found</h1>
            <p className="mt-3 text-sm text-muted">
              <span className="break-all font-mono">{txHash.length > 80 ? `${txHash.slice(0, 80)}…` : txHash}</span>{" "}
              isn&apos;t a settle() transaction on Arc testnet, or the transaction is too new for the explorer to have
              indexed yet.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
