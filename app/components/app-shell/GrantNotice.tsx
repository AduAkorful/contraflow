"use client";

import { useEffect, useState } from "react";
import { onGrantNotice, takeGrantNotice } from "../../src/attest/grantNotice";

const VISIBLE_MS = 12_000;

/// Tells the user right after sign-in that the starter grant arrived.
export function GrantNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const waiting = takeGrantNotice();
    if (waiting) setMessage(waiting);
    return onGrantNotice((next) => {
      takeGrantNotice();
      setMessage(next);
    });
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-card border border-gold/40 bg-surface-1 px-4 py-3 text-sm shadow-lg" role="status">
      <p>{message}</p>
      <button type="button" onClick={() => setMessage(null)} className="text-muted hover:text-foreground" aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
