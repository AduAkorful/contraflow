/// Server-only: the invoice IDs a demo run actually registered, stored for the settle step.
/// Invoice IDs are EIP-712 hashes of the full attestation, including maturity. Re-deriving
/// that hash at settle time with a new `now` produces different IDs than the ones that
/// landed onchain, so the run-binding check must compare against this record instead.

import { redis } from "../upstash/client";

const RUN_TTL_SECONDS = 2 * 60 * 60;

export const DEMO_RUN_EXPIRED_MESSAGE = "This demo run has expired. Start a new one.";
export const DEMO_RUN_UNAVAILABLE_MESSAGE = "Demo run records are unavailable. Try again later.";

function runIdsKey(runSalt: string): string {
  return `demo:run:${runSalt}:ids`;
}

function normalizeInvoiceId(invoiceId: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(invoiceId)) return null;
  return invoiceId.toLowerCase();
}

export type DemoRunIds =
  | { kind: "ids"; ids: string[] }
  | { kind: "missing" }
  | { kind: "unavailable" };

function asIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/// Records one registered invoice ID for this run and refreshes the TTL. Failures are logged
/// and swallowed: a chain write that already succeeded must still be reported as success.
export async function rememberDemoRunInvoiceId(runSalt: string, invoiceId: string): Promise<void> {
  if (!runSalt || runSalt.length > 128) return;
  const id = normalizeInvoiceId(invoiceId);
  if (!id) return;
  try {
    const key = runIdsKey(runSalt);
    const ids = asIdList(await redis().get<string[]>(key));
    if (!ids.includes(id)) ids.push(id);
    await redis().set(key, ids, { ex: RUN_TTL_SECONDS });
  } catch (err) {
    console.error("Demo run invoice id could not be recorded:", err);
  }
}

export async function loadDemoRunInvoiceIds(runSalt: string): Promise<DemoRunIds> {
  if (!runSalt || runSalt.length > 128) return { kind: "missing" };
  try {
    const ids = asIdList(await redis().get<string[]>(runIdsKey(runSalt)))
      .map((value) => value.toLowerCase())
      .filter((value) => /^0x[0-9a-f]{64}$/.test(value));
    if (ids.length === 0) return { kind: "missing" };
    return { kind: "ids", ids };
  } catch {
    return { kind: "unavailable" };
  }
}

export function demoRunIdsMatch(stored: string[], requested: string[]): boolean {
  const expected = new Set(stored.map((id) => id.toLowerCase()));
  const got = requested.map((id) => id.toLowerCase());
  return expected.size === got.length && got.length === new Set(got).size && got.every((id) => expected.has(id));
}
