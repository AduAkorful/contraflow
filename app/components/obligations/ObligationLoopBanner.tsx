"use client";

import { useEffect, useRef, useState } from "react";
import { findNettingLoop } from "../../src/app/app/obligations/actions";
import type { CertificateSummary } from "../../src/obligations/certificates";
import { loopBannerTarget } from "../../src/obligations/loopBanner";

export function ObligationLoopBanner({ certificates }: { certificates: CertificateSummary[] }) {
  const [foundToken, setFoundToken] = useState<string | null>(null);
  const searched = useRef(false);

  useEffect(() => {
    if (searched.current) return;
    searched.current = true;
    const hasOpen = certificates.some((c) => c.status === "collecting" || c.status === "ready");
    if (hasOpen) return;
    findNettingLoop()
      .then((result) => {
        if (result.ok && result.outcome.found) setFoundToken(result.outcome.token);
      })
      // The search is a convenience here; /app/obligations offers it again with its errors shown.
      .catch((err) => console.error("Obligation loop search failed:", err));
  }, [certificates]);

  const token = loopBannerTarget(certificates, foundToken);
  if (!token) return null;

  return (
    <p className="px-5 py-4 text-sm">
      These obligations form a loop ·{" "}
      <a href={`/app/c/${token}`} className="text-gold hover:underline">
        Review &amp; sign →
      </a>
    </p>
  );
}
