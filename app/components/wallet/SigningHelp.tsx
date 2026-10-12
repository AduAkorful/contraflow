"use client";

import { useEffect, useState } from "react";
import { useSignIn } from "./signInContext";

const SHOW_AFTER_MS = 12_000;

/// Shown only when a sign-in has been waiting a while. A wallet extension can hold more than one
/// request at once (its own connection request, an earlier attempt, and ours), and shows only the
/// first as a pop-up, so the person is told where the rest are and can start over.
export function SigningHelp({ className }: { className?: string }) {
  const { phase, cancel } = useSignIn();
  const waiting = phase === "connecting" || phase === "signing";
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (!waiting) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  if (!waiting || !late) return null;
  return (
    <div className={className ?? "max-w-xs text-center text-sm text-muted"} role="status">
      <p>
        Still waiting? Your wallet may be holding more than one request. Open the wallet extension and approve or reject
        each one. If it has several accounts, check the account you want to use is the active one. Or start over.
      </p>
      <button type="button" onClick={cancel} className="mt-2 text-gold hover:underline">
        Start over
      </button>
    </div>
  );
}
