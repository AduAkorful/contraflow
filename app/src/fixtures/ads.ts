/// The canonical demo fixture: three ads-industry roles forming a closed 3-cycle so the reviewer
/// can settle immediately.
///
///   Northwind DSP  --owes-->  Meridian Exchange   (cleared impressions)
///   Meridian Exchange --owes-->  Atlas Publisher   (supply payout)
///   Atlas Publisher --owes-->  Northwind DSP        (audience / data / make-good contra)
///
/// `earlyNetConsent = true` on all three so the demo doesn't have to wait on `maturity`.

import { keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import type { InvoiceAttestation } from "../attest/signAttestation";

export type FixtureRole = "northwind" | "meridian" | "atlas";

export interface FixtureRoleAddresses {
  northwind: Address;
  meridian: Address;
  atlas: Address;
}

interface FixtureInvoiceSpec {
  label: string;
  debtorRole: FixtureRole;
  creditorRole: FixtureRole;
  /// 6-decimal USDC amount, as a human string (e.g. "1000") — converted via parseUnits.
  amountUsdc: string;
  /// Used only to derive a unique, human-traceable `invoiceRef`; not itself part of the
  /// signed struct's economic meaning.
  refSeed: string;
}

export const FIXTURE_INVOICES: readonly FixtureInvoiceSpec[] = [
  { label: "Northwind DSP -> Meridian Exchange", debtorRole: "northwind", creditorRole: "meridian", amountUsdc: "1000", refSeed: "cleared-impressions" },
  { label: "Meridian Exchange -> Atlas Publisher", debtorRole: "meridian", creditorRole: "atlas", amountUsdc: "1000", refSeed: "supply-payout" },
  { label: "Atlas Publisher -> Northwind DSP", debtorRole: "atlas", creditorRole: "northwind", amountUsdc: "1000", refSeed: "audience-data-contra" },
] as const;

const USDC_DECIMALS = 6;

/// Default maturity offset used when the caller doesn't supply one: 30 days out, matching the
/// pattern used throughout the contracts' own test suite. Doesn't matter for the demo since
/// `earlyNetConsent = true` lets `netInvoice` proceed before maturity anyway.
export const DEFAULT_MATURITY_OFFSET_SECONDS = 30n * 24n * 60n * 60n;

export interface BuildFixtureAttestationsParams {
  roles: FixtureRoleAddresses;
  currency: Address;
  registry: Address;
  chainId: bigint;
  /// Next nonce to use for each (debtor, creditor) pair — the registry requires the exact
  /// next sequential nonce per pair (see `ContraflowRegistry.register`'s `NonceNotSequential`),
  /// so the caller must resolve this from on-chain state before building attestations, e.g. via
  /// `readLastNonce` in `chain/readInvoices.ts`. Keyed by `"${debtorRole}->${creditorRole}"`.
  nextNonces: Partial<Record<`${FixtureRole}->${FixtureRole}`, bigint>>;
  /// Unix seconds; defaults to `now + DEFAULT_MATURITY_OFFSET_SECONDS`.
  nowUnixSeconds?: bigint;
}

export interface FixtureAttestation {
  label: string;
  attestation: InvoiceAttestation;
  debtorRole: FixtureRole;
  creditorRole: FixtureRole;
}

/// Deterministic per-invoice `invoiceRef`, distinct across repeated demo runs because it folds
/// in the nonce (which itself must increase per pair on every real run).
function buildInvoiceRef(spec: FixtureInvoiceSpec, nonce: bigint): Hex {
  return keccak256(toHex(`contraflow-fixture:${spec.refSeed}:${nonce.toString()}`));
}

export function buildFixtureAttestations(params: BuildFixtureAttestationsParams): FixtureAttestation[] {
  const now = params.nowUnixSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  const maturity = now + DEFAULT_MATURITY_OFFSET_SECONDS;

  return FIXTURE_INVOICES.map((spec) => {
    const pairKey = `${spec.debtorRole}->${spec.creditorRole}` as const;
    const nonce = params.nextNonces[pairKey];
    if (nonce === undefined) {
      throw new Error(`buildFixtureAttestations: missing nextNonces entry for "${pairKey}"`);
    }

    const attestation: InvoiceAttestation = {
      invoiceRef: buildInvoiceRef(spec, nonce),
      amount: parseUnits(spec.amountUsdc, USDC_DECIMALS),
      currency: params.currency,
      maturity,
      earlyNetConsent: true,
      debtor: params.roles[spec.debtorRole],
      creditor: params.roles[spec.creditorRole],
      nonce,
      registry: params.registry,
      chainId: params.chainId,
    };

    return { label: spec.label, attestation, debtorRole: spec.debtorRole, creditorRole: spec.creditorRole };
  });
}
