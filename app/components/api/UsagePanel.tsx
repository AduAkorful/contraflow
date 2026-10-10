import type { TenantUsage } from "@/src/api/usage";
import { Address } from "@/components/ui/Address";

const STATE_LABEL: Record<string, string> = {
  live: "Live",
  expiring: "Expires within 7 days",
  expired: "Expired",
  revoked: "Revoked",
  none: "No permission",
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "Never";
}

export function UsagePanel({ usage }: { usage: TenantUsage | null }) {
  if (!usage) return <p className="mt-8 text-sm text-muted">Usage isn&apos;t available right now.</p>;
  const { totals } = usage;
  if (totals.requests === 0 && usage.keys.every((k) => !k.lastUsedAt)) {
    return (
      <section aria-labelledby="usage-heading" className="mt-10">
        <h2 id="usage-heading" className="text-sm font-medium">Usage, last 30 days</h2>
        <p className="mt-2 text-sm text-muted">No requests yet.</p>
      </section>
    );
  }
  const peak = Math.max(1, ...usage.daily.map((d) => d.requests));
  return (
    <section aria-labelledby="usage-heading" className="mt-10 space-y-8">
      <div>
        <h2 id="usage-heading" className="text-sm font-medium">
          Usage, {usage.from} to {usage.to}
        </h2>
        <p className="mt-1 text-xs text-muted">
          Counts of your own calls, by day (UTC). Recorded from when this view shipped and approximate.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["Requests", totals.requests],
            ["Succeeded", totals.byStatusClass["2xx"]],
            ["Client errors", totals.byStatusClass["4xx"]],
            ["Server errors", totals.byStatusClass["5xx"]],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-card border border-border bg-surface-1 p-4">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-1 text-xl tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex h-16 items-end gap-0.5" role="img" aria-label={`Requests per day, peak ${peak}`}>
          {usage.daily.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${d.requests} requests, ${d.errors} errors`}
              className="w-full bg-gold/60"
              style={{ height: `${Math.max(4, Math.round((d.requests / peak) * 100))}%` }}
            />
          ))}
        </div>
      </div>

      {totals.byOperation.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">By operation</h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr><th className="py-1 font-normal">Operation</th><th className="py-1 text-right font-normal">Requests</th><th className="py-1 text-right font-normal">Errors</th></tr>
            </thead>
            <tbody>
              {totals.byOperation.map((o) => (
                <tr key={o.operation} className="border-t border-border">
                  <td className="py-1.5 font-mono text-xs">{o.operation}</td>
                  <td className="py-1.5 text-right tabular-nums">{o.requests}</td>
                  <td className="py-1.5 text-right tabular-nums">{o.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totals.topErrorCodes.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Error codes: {totals.topErrorCodes.map((e) => `${e.code} ${e.count}`).join(", ")}
            </p>
          )}
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium">Keys</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {usage.keys.map((k) => (
            <li key={k.prefix} className="flex justify-between gap-4 border-t border-border py-1.5">
              <span className="font-mono text-xs">{k.prefix}…{k.revoked ? " (revoked)" : ""}</span>
              <span className="text-muted">Last used {when(k.lastUsedAt)}</span>
            </li>
          ))}
        </ul>
      </div>

      {usage.parties.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Parties you act for</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 font-normal">Party</th>
                  <th className="py-1 font-normal">Permission</th>
                  <th className="py-1 text-right font-normal">Requests</th>
                  <th className="py-1 text-right font-normal">Errors</th>
                  <th className="py-1 text-right font-normal">Webhooks sent / failed / suppressed</th>
                </tr>
              </thead>
              <tbody>
                {usage.parties.map((p) => (
                  <tr key={p.party} className="border-t border-border align-top">
                    <td className="py-1.5"><Address address={p.party as `0x${string}`} /></td>
                    <td className="py-1.5">{STATE_LABEL[p.permission.status]}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.requests}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.errors}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {p.webhooks.sent} / {p.webhooks.failed} / {p.webhooks.suppressed}
                      {p.webhooks.lastError && <span className="block text-xs text-muted">{p.webhooks.lastError}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {usage.nextCursor && <p className="mt-2 text-xs text-muted">More parties are available through the API.</p>}
        </div>
      )}
    </section>
  );
}
