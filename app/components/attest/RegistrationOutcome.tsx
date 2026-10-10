import { Money } from "../ui/Money";
import { RegisterProgress } from "./RegisterProgress";
import { formatUsdcAmount } from "../../src/attest/amount";

/// The registration outcome cards on an invoice link: confirmed, or a status that needs checking.

export function RegisteredCard({
  txHash,
  explorerBase,
  amount,
  registryId,
  documentHash,
  grantNote,
  recordWarning,
  sessionAddress,
}: {
  txHash: string;
  explorerBase: string | undefined;
  amount: bigint | null;
  registryId: string | null;
  documentHash: string | null;
  grantNote: string | null;
  recordWarning: string | null;
  sessionAddress: string | null | undefined;
}) {
  return (
    <div className="animate-card-entrance rounded-card border border-gold/30 bg-gold/[0.06] p-6 text-center">
      <p className="flex items-center justify-center gap-1.5 text-sm">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true" className="text-gold">
          <path
            d="M3 8.5 L6.5 12 L13 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-check-draw"
            pathLength={32}
          />
        </svg>
        Invoice registered on Arc
      </p>
      <div className="mt-4">
        <RegisterProgress step={3} txHash={txHash} explorerBase={explorerBase} />
      </div>
      {grantNote && <p className="mt-3 text-xs text-muted">{grantNote}</p>}
      <p className="mt-3 text-xs text-muted">
        {amount !== null ? <Money value={formatUsdcAmount(amount)} className="text-foreground" /> : "This invoice"} is now registered.
        If it forms a loop with other invoices, you'll see a Settle button on your Overview.
      </p>
      {registryId && (
        <p className="mt-3 text-xs text-faint">
          Invoice ID <span className="break-all font-mono text-muted">{registryId}</span>
        </p>
      )}
      {documentHash && (
        <p className="mt-1 text-xs text-faint">
          Document hash <span className="break-all font-mono text-muted">{documentHash}</span>
        </p>
      )}
      {recordWarning && <p className="mt-3 text-xs text-muted">{recordWarning}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
        {sessionAddress && (
          <a href={`/app/history?address=${sessionAddress}`} className="text-gold hover:underline">
            See it in your history →
          </a>
        )}
        {explorerBase && (
          <a href={`${explorerBase}/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-muted hover:underline">
            View transaction →
          </a>
        )}
        <a href="/app/attest" className="text-muted hover:underline">
          Send another invoice →
        </a>
      </div>
    </div>
  );
}

export function RegistrationStatusCard({
  status,
  error,
  txHash,
  explorerBase,
}: {
  status: "pending" | "reverted";
  error: string | null;
  txHash: string | null;
  explorerBase: string | undefined;
}) {
  return (
    <div className="animate-card-entrance rounded-card border border-white/10 bg-white/[0.02] p-6 text-center">
      <p className="text-sm font-medium">{status === "pending" ? "Registration status needs checking" : "Registration reverted"}</p>
      <p className="mt-2 text-sm text-muted">{error}</p>
      {txHash && explorerBase && (
        <a href={`${explorerBase}/tx/${txHash}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-xs text-gold hover:underline">
          Check transaction on Arc →
        </a>
      )}
    </div>
  );
}
