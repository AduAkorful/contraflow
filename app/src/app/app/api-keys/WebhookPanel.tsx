"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { OwnDeliveryView, OwnWebhookView } from "@/src/api/ownWebhook";
import { deleteOwnWebhook, rollOwnWebhook, saveOwnWebhook, sendOwnWebhookTest } from "./actions";

function outcome(d: OwnDeliveryView): string {
  if (d.status === "delivered") return `Delivered${d.statusCode ? ` (${d.statusCode})` : ""}`;
  if (d.status === "suppressed") return "Not sent: permission no longer active";
  const reason = d.error ?? (d.statusCode ? `Your endpoint answered ${d.statusCode}` : null);
  if (d.status === "failed") return `Failed${reason ? `: ${reason}` : ""}`;
  return d.attempts > 0 ? `Retrying${reason ? `: ${reason}` : ""}` : "Queued";
}

export function WebhookPanel({
  webhook,
  deliveries,
  unavailable,
  suspended,
}: {
  webhook: OwnWebhookView | null;
  deliveries: OwnDeliveryView[];
  unavailable: boolean;
  suspended: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [secret, setSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: () => ReturnType<typeof saveOwnWebhook>, done?: string) {
    setError(null);
    setNotice(null);
    setCopied(false);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSecret(result.secret ?? null);
      if (done) setNotice(done);
      router.refresh();
    });
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError("Select the secret and copy it.");
    }
  }

  return (
    <div className="mt-10">
      <h2 className="text-sm font-medium">Webhook endpoint</h2>
      <p className="mt-1 text-sm text-muted">
        Contraflow sends signed events, such as <span className="font-mono">certificate.applied</span>, to one HTTPS URL.
        Use it to update your books when a certificate is applied.
      </p>

      {unavailable ? (
        <p className="mt-3 text-sm text-muted">Webhooks aren&apos;t available right now.</p>
      ) : suspended ? (
        <p className="mt-3 text-sm text-muted">This API access is suspended.</p>
      ) : (
        <>
          {secret && (
            <div className="mt-4 rounded-card border border-gold/40 bg-surface-1 p-5">
              <p className="text-sm font-medium">Copy this signing secret now. It is shown once.</p>
              <p className="mt-3 break-all font-mono text-sm">{secret}</p>
              <button
                type="button"
                onClick={() => void copy()}
                className="mt-3 rounded-pill border border-border-input px-4 py-2 text-sm hover:border-white/30"
              >
                {copied ? "Copied" : "Copy secret"}
              </button>
            </div>
          )}

          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => saveOwnWebhook(url), webhook ? "Endpoint updated with a new signing secret." : "Endpoint saved.");
            }}
          >
            <label className="flex-1">
              <span className="sr-only">Endpoint URL</span>
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/contraflow/webhooks"
                className="w-full rounded-lg border border-border-input bg-surface-1 px-4 py-3 font-mono text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={pending || url.trim().length === 0}
              className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
            >
              {pending ? "Working…" : webhook ? "Replace endpoint" : "Save endpoint"}
            </button>
          </form>

          {error && <p className="mt-3 text-sm text-muted">{error}</p>}
          {notice && !error && <p className="mt-3 text-sm text-muted">{notice}</p>}

          {webhook && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <button type="button" disabled={pending} onClick={() => run(sendOwnWebhookTest, "Test event queued. Refresh in a moment.")} className="text-gold hover:underline disabled:state-disabled">
                Send a test event
              </button>
              <button type="button" disabled={pending} onClick={() => run(rollOwnWebhook, "New signing secret created. The old one also signs for 24 hours.")} className="text-muted hover:text-foreground disabled:state-disabled">
                Roll secret
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setUrl("");
                  run(deleteOwnWebhook, "Endpoint removed. Queued events were dropped.");
                }}
                className="text-muted hover:text-foreground disabled:state-disabled"
              >
                Remove
              </button>
              <button type="button" onClick={() => router.refresh()} className="text-muted hover:text-foreground">
                Refresh
              </button>
              {webhook.rollingUntil && (
                <span className="text-muted">Old secret also signs until {new Date(webhook.rollingUntil).toLocaleString()}.</span>
              )}
            </div>
          )}

          {deliveries.length > 0 && (
            <ul className="mt-5 divide-y divide-border-subtle rounded-card border border-border-subtle text-sm">
              {deliveries.map((d) => (
                <li key={d.eventId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <span className="font-mono">{d.type}</span>
                  <span className="text-muted">
                    {outcome(d)} · {new Date(d.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
