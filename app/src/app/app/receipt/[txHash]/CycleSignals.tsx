"use client";

import { useEffect, useState } from "react";
import { CycleSignalsPanel, SignalsLoading, SignalsUnavailable } from "@/components/inspector/SignalsPanels";
import { lookupCycleSignals, type CycleSignalsResult } from "./actions";

const TITLE = "About the parties in this cycle";

/// Fetched after the receipt renders, so the receipt itself never waits on the explorer.
export function CycleSignals({ txHash }: { txHash: string }) {
  const [result, setResult] = useState<CycleSignalsResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    lookupCycleSignals(txHash).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [txHash]);

  if (!result) return <SignalsLoading title={TITLE} />;
  if (!result.ok) return <SignalsUnavailable title={TITLE} message={result.error} />;
  return <CycleSignalsPanel signals={result.signals} />;
}
