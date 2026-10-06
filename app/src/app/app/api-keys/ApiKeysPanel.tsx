"use client";

import { useState, useTransition } from "react";
import type { OwnTenantView } from "@/src/api/ownKeys";
import { createOwnTestKey, revokeOwnTestKey } from "./actions";

export function ApiKeysPanel({ tenant }: { tenant: OwnTenantView | null }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = tenant?.keys.filter((key) => !key.revoked).length ?? 0;
  const suspended = tenant?.status === "suspended";
  const atCap = active >= 2;

  function createKey() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createOwnTestKey();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSecret(result.key);
    });
  }

  function revoke(prefix: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeOwnTestKey(prefix);
      if (!result.ok) setError(result.error);
      else if (secret?.startsWith(prefix)) setSecret(null);
    });
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError("Select the key and copy it.");
    }
  }

  return (
    <div className="mt-8 space-y-8">
      {secret && (
        <div className="rounded-card border border-gold/40 bg-surface-1 p-5">
          <p className="text-sm font-medium">Copy this key now. It is shown once.</p>
          <p className="mt-1 text-sm text-muted">
            If you leave this page before copying it, revoke that prefix and create another.
          </p>
          <p className="mt-3 break-all font-mono text-sm">{secret}</p>
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-3 rounded-pill border border-border-input px-4 py-2 text-sm hover:border-white/30"
          >
            {copied ? "Copied" : "Copy key"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-muted">{error}</p>}

      <div>
        {suspended ? (
          <p className="text-sm text-muted">This API access is suspended.</p>
        ) : (
          <button
            type="button"
            onClick={createKey}
            disabled={pending || atCap}
            className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
          >
            {pending ? "Working…" : "Create a test key"}
          </button>
        )}
        {atCap && !suspended && (
          <p className="mt-3 text-sm text-muted">You already have two active keys. Revoke one to create another.</p>
        )}
      </div>

      {tenant && (
        <div>
          <h2 className="text-sm font-medium">Tenant</h2>
          <p className="mt-1 break-all font-mono text-sm text-muted">{tenant.tenantId}</p>
          <h2 className="mt-6 text-sm font-medium">Keys</h2>
          {tenant.keys.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No keys yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle rounded-card border border-border-subtle">
              {tenant.keys.map((key) => (
                <li key={`${key.prefix}-${key.createdAt}`} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span>
                    <span className="font-mono">{key.prefix}</span>
                    <span className="ml-3 text-muted">{key.revoked ? "Revoked" : "Active"}</span>
                  </span>
                  {!key.revoked && (
                    <button
                      type="button"
                      onClick={() => revoke(key.prefix)}
                      disabled={pending}
                      className="text-sm text-muted hover:text-foreground disabled:state-disabled"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
