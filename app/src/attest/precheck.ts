/// Non-broadcasting pre-check. Re-derives everything itself rather than trusting the client's
/// claims: re-recovers both signatures against the exact struct sent, re-resolves the
/// nonce live, and runs the real compliance screen. Only if every check passes is the caller told
/// it's safe to self-submit `register()`.

import { isAddress, isHash, recoverTypedDataAddress, type Hex } from "viem";
import { invoiceAttestationTypedData, type InvoiceAttestation } from "./signAttestation";
import { resolveNextNonce } from "./nextNonce";
import { defaultComplianceProvider, screenAddresses } from "../compliance";
import { checkRateLimit } from "../ratelimit/limiter";
import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

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

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function invalidAttestationReason(invoice: InvoiceAttestation): string | null {
  if (!invoice || typeof invoice !== "object") return "Invoice data is invalid.";
  if (!isHash(invoice.invoiceRef)) return "Invoice reference must be a 32-byte hash.";
  if (typeof invoice.amount !== "bigint" || invoice.amount <= 0n || invoice.amount > MAX_UINT256) {
    return "Invoice amount must be a positive uint256.";
  }
  if (!isAddress(invoice.currency) || !isAddress(invoice.registry) || !isAddress(invoice.debtor) || !isAddress(invoice.creditor)) {
    return "Invoice contains an invalid address.";
  }
  if (invoice.debtor.toLowerCase() === ZERO_ADDRESS || invoice.creditor.toLowerCase() === ZERO_ADDRESS) {
    return "Invoice parties cannot be the zero address.";
  }
  if (invoice.debtor.toLowerCase() === invoice.creditor.toLowerCase()) {
    return "Invoice parties must be different addresses.";
  }
  if (typeof invoice.maturity !== "bigint" || invoice.maturity < 0n || invoice.maturity > MAX_UINT64) {
    return "Invoice maturity must fit uint64.";
  }
  if (typeof invoice.nonce !== "bigint" || invoice.nonce <= 0n || invoice.nonce > MAX_UINT256) {
    return "Invoice nonce must be a positive uint256.";
  }
  if (typeof invoice.earlyNetConsent !== "boolean") return "Invoice consent value is invalid.";
  if (typeof invoice.chainId !== "bigint" || invoice.chainId !== BigInt(ARC_TESTNET_CHAIN_ID)) {
    return "Invoice is for a different chain.";
  }

  const configured = addressesForChain(ARC_TESTNET_CHAIN_ID);
  if (invoice.registry.toLowerCase() !== configured.registry.toLowerCase()) {
    return "Invoice is for a different Registry.";
  }
  if (invoice.currency.toLowerCase() !== configured.usdc.toLowerCase()) {
    return "Invoice is not denominated in the configured USDC asset.";
  }
  return null;
}

export async function preCheckAttestation(input: PreCheckInput): Promise<PreCheckResult> {
  const { invoice, debtorSignature, creditorSignature } = input;

  let rateLimit;
  try {
    rateLimit = await checkRateLimit(`precheck:${input.rateLimitKey}`, PRECHECK_RATE_LIMIT_MAX, PRECHECK_RATE_LIMIT_WINDOW_SECONDS);
  } catch {
    return { ok: false, reason: "Pre-check is temporarily unavailable." };
  }
  if (!rateLimit.allowed) {
    return { ok: false, reason: "Too many pre-check attempts — try again shortly." };
  }

  const invalidReason = invalidAttestationReason(invoice);
  if (invalidReason) return { ok: false, reason: invalidReason };

  let typedData;
  try {
    typedData = invoiceAttestationTypedData(invoice);
  } catch {
    return { ok: false, reason: "Invoice data is invalid." };
  }

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

  let expectedNonce: bigint;
  try {
    expectedNonce = await resolveNextNonce(invoice.debtor, invoice.creditor);
  } catch {
    return { ok: false, reason: "Could not verify the invoice nonce against Arc." };
  }
  if (invoice.nonce !== expectedNonce) {
    return {
      ok: false,
      reason: `Nonce is stale (expected ${expectedNonce}, invoice has ${invoice.nonce}) — this invoice may already be registered, or a newer one exists for this pair.`,
    };
  }

  let screenResults;
  try {
    screenResults = await screenAddresses([invoice.debtor, invoice.creditor], defaultComplianceProvider());
  } catch {
    return { ok: false, reason: "Compliance screening is temporarily unavailable." };
  }
  const flagged = screenResults.filter((r) => r.status === "flagged");
  if (flagged.length > 0) {
    return { ok: false, reason: "Blocked by compliance screening." };
  }

  return { ok: true };
}
