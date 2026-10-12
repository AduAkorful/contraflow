"use server";

import { isHash } from "viem";
import { getCycleSignals } from "@/src/inspector/load";
import { guardInspectorRequest, SIGNALS_NOT_SUPPORTED_PARTIES, SIGNALS_UNAVAILABLE } from "@/src/inspector/requestGuard";
import { hasBlockscoutApi } from "@/src/blockscout/explorer";
import { APP_CHAIN_ID } from "@/src/contracts/addresses";
import type { CycleSignals } from "@/src/inspector/signals";

export type CycleSignalsResult = { ok: true; signals: CycleSignals } | { ok: false; error: string };

export async function lookupCycleSignals(txHash: string): Promise<CycleSignalsResult> {
  if (!isHash(txHash)) return { ok: false, error: "Not a valid transaction hash." };
  if (!hasBlockscoutApi(APP_CHAIN_ID)) return { ok: false, error: SIGNALS_NOT_SUPPORTED_PARTIES };

  const guard = await guardInspectorRequest("cycle");
  if (!guard.allowed) return { ok: false, error: guard.error };

  try {
    const signals = await getCycleSignals(txHash);
    return signals ? { ok: true, signals } : { ok: false, error: SIGNALS_UNAVAILABLE };
  } catch {
    return { ok: false, error: SIGNALS_UNAVAILABLE };
  }
}
