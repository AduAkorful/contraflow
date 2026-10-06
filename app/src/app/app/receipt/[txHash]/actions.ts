"use server";

import { isHash } from "viem";
import { getCycleSignals } from "../../../../src/inspector/load";
import { guardInspectorRequest, SIGNALS_UNAVAILABLE } from "../../../../src/inspector/requestGuard";
import type { CycleSignals } from "../../../../src/inspector/signals";

export type CycleSignalsResult = { ok: true; signals: CycleSignals } | { ok: false; error: string };

export async function lookupCycleSignals(txHash: string): Promise<CycleSignalsResult> {
  if (!isHash(txHash)) return { ok: false, error: "Not a valid transaction hash." };

  const guard = await guardInspectorRequest("cycle");
  if (!guard.allowed) return { ok: false, error: guard.error };

  try {
    const signals = await getCycleSignals(txHash);
    return signals ? { ok: true, signals } : { ok: false, error: SIGNALS_UNAVAILABLE };
  } catch {
    return { ok: false, error: SIGNALS_UNAVAILABLE };
  }
}
