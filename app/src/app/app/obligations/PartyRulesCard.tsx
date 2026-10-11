"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMyNettingRules } from "./actions";

/// Counterparty rules: with the allowlist on, this party only nets in loops whose other members
/// are all on its approved list. Enforced for every loop proposal and every signature.
export function PartyRulesCard({ enabled: initialEnabled, allowed }: { enabled: boolean; allowed: string[] }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [text, setText] = useState(allowed.join("\n"));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveMyNettingRules(enabled, text);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setText(result.rules.allowed.join("\n"));
      setEnabled(result.rules.enabled);
      setMessage("Saved.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-card border border-border-subtle bg-surface-1 p-5">
      <h2 className="text-xs uppercase tracking-wide text-muted">Counterparty rules</h2>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 accent-gold" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Only net with approved addresses</span>
      </label>
      <p className="mt-1 text-xs text-muted">
        When on, you are only in loops where every other party is on this list. Nothing else is netted for you.
      </p>
      <label className="mt-3 block text-xs text-muted" htmlFor="approved-addresses">
        Approved addresses, one per line
      </label>
      <textarea
        id="approved-addresses"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        spellCheck={false}
        className="mt-1 w-full rounded-lg border border-border-input bg-bg px-3 py-2 font-mono text-xs"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-pill border border-border-input px-4 py-1.5 text-sm hover:border-white/30 disabled:state-disabled"
        >
          {pending ? "Saving…" : "Save rules"}
        </button>
        {message && <span className="text-xs text-muted">{message}</span>}
      </div>
    </div>
  );
}
