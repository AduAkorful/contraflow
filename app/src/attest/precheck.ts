/// Non-broadcasting pre-check — plans/21-real-mode-attest-flow.md / plan 14's "Starter gas grant +
/// self-submission" §2. Re-derives everything itself rather than trusting the client's claims
/// (design decision 5): re-recovers both signatures against the exact struct sent, re-resolves the
/// nonce live, and runs the real compliance screen. Only if every check passes is the caller told
/// it's safe to self-submit `register()`.

import { recoverTypedDataAddress, type Hex } from "viem";
import { invoiceAttestationTypedData, type InvoiceAttestation } from "./signAttestation";
import { resolveNextNonce } from "./nextNonce";
import { defaultComplianceProvider, screenAddresses } from "../compliance";
import { checkRateLimit } from "../ratelimit/limiter";

const PRECHECK_RATE_LIMIT_MAX = 10;
const PRECHECK_RATE_LIMIT_WINDOW_SECONDS = 60;

export type PreCheckResult = { ok: true } | { ok: false; reason: string };

export interface PreCheckInput {
  invoice: InvoiceAttestation;
  debtorSignature: Hex;
  creditorSignature: Hex;
  /// Rate-limit key — the caller's own session address (a verified identity already exists by the
  /// time either party reaches this step, per step 20's session layer).
  rateLimitKey: string;
}

export async function preCheckAttestation(input: PreCheckInput): Promise<PreCheckResult> {
  const { invoice, debtorSignature, creditorSignature } = input;

  const rateLimit = await checkRateLimit(`precheck:${input.rateLimitKey}`, PRECHECK_RATE_LIMIT_MAX, PRECHECK_RATE_LIMIT_WINDOW_SECONDS);
  if (!rateLimit.allowed) {
    return { ok: false, reason: "Too many pre-check attempts — try again shortly." };
  }

  const typedData = invoiceAttestationTypedData(invoice);

  let recoveredDebtor: Hex, recoveredCreditor: Hex;
  try {
    recoveredDebtor = (await recoverTypedDataAddress({ ...typedData, signature: debtorSignature })) as Hex;
    recoveredCreditor = (await recoverTypedDataAddress({ ...typedData, signature: creditorSignature })) as Hex;
  } catch {
    return { ok: false, reason: "One or both signatures do not recover to a valid address." };
  }

  if (recoveredDebtor.toLowerCase() !== invoice.debtor.toLowerCase()) {
    return { ok: false, reason: "Debtor signature does not match the invoice's debtor address." };
  }
  if (recoveredCreditor.toLowerCase() !== invoice.creditor.toLowerCase()) {
    return { ok: false, reason: "Creditor signature does not match the invoice's creditor address." };
  }

  const expectedNonce = await resolveNextNonce(invoice.debtor, invoice.creditor);
  if (invoice.nonce !== expectedNonce) {
    return {
      ok: false,
      reason: `Nonce is stale (expected ${expectedNonce}, invoice has ${invoice.nonce}) — this invoice may already be registered, or a newer one exists for this pair.`,
    };
  }

  const screenResults = await screenAddresses([invoice.debtor, invoice.creditor], defaultComplianceProvider());
  const flagged = screenResults.filter((r) => r.status === "flagged");
  if (flagged.length > 0) {
    return { ok: false, reason: "Blocked by compliance screening." };
  }

  return { ok: true };
}
