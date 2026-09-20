/// Business logic behind the Attest screen (spec §9.1 screen 2): sign + submit `register()` for
/// the fixture invoices. Framework-agnostic on purpose — a Next.js server action just imports
/// and calls `registerFixtureInvoices`; this file has no dependency on Next.js itself, so it's
/// directly unit/integration-testable without spinning up a dev server.

import type { Address, Hex, PublicClient } from "viem";
import { encodeFunctionData } from "viem";
import { contraflowRegistryAbi } from "../contracts/abi/index";
import { invoiceAttestationId, signAttestation, type InvoiceAttestation } from "../attest/signAttestation";
import { buildFixtureAttestations, type FixtureRoleAddresses } from "../fixtures/ads";
import { readNextNonce } from "../chain/readInvoices";
import { defaultComplianceProvider, screenAddresses, type ComplianceProvider } from "../compliance";
import { submitContractExecutionViaDcw } from "../dcw/contractExecution";
import type { OperatorSigner } from "../operator/signer";

export interface RegisterResult {
  label: string;
  invoiceId: Hex;
  txHash: Hex;
  blockNumber: bigint;
}

/// Spec FR-1.3: "Before register, the application calls ... screening. Flagged addresses are not
/// inserted." Thrown before any submission is attempted — no gas spent screening off-chain.
export class ComplianceRejectedError extends Error {
  constructor(public readonly flagged: Address[]) {
    super(`registerInvoice: address(es) flagged by compliance pre-screen: ${flagged.join(", ")}`);
    this.name = "ComplianceRejectedError";
  }
}

/// Submits one already-signed attestation's `register()` call, regardless of which kind of
/// `OperatorSigner` is given — callers no longer choose between a raw-key function and a
/// `*ViaDcw` one (see `plans/11-orchestration.md`; this replaces the two-function shape from
/// `plans/10-dcw-register-settle.md`). Signer may be any funded account — `register()` is open to
/// "either party or the operator" (spec FR-1.2), not restricted to the debtor or creditor.
export async function registerInvoice(params: {
  publicClient: PublicClient;
  signer: OperatorSigner;
  registry: Address;
  invoice: InvoiceAttestation;
  debtorSignature: Hex;
  creditorSignature: Hex;
  /// Defaults to `defaultComplianceProvider()` (denylist + stub, spec FR-1.3) — override in
  /// tests, or once a real vendor is wired in.
  complianceProvider?: ComplianceProvider;
}): Promise<{ invoiceId: Hex; txHash: Hex; blockNumber: bigint }> {
  const { publicClient, signer, registry, invoice, debtorSignature, creditorSignature } = params;

  const complianceProvider = params.complianceProvider ?? defaultComplianceProvider();
  const screenResults = await screenAddresses([invoice.debtor, invoice.creditor], complianceProvider);
  const flagged = screenResults.filter((r) => r.status === "flagged").map((r) => r.address);
  if (flagged.length > 0) throw new ComplianceRejectedError(flagged);

  // Computed client-side, not parsed from the receipt's logs — `id` is a pure function of the
  // signed struct (see invoiceAttestationId's doc comment), so it's known before the tx even
  // lands and matches exactly what `register()` returns/emits on-chain.
  const invoiceId = invoiceAttestationId(invoice);

  if (signer.kind === "raw-key") {
    const { walletClient } = signer;
    if (!walletClient.account) throw new Error("registerInvoice: raw-key signer has no account attached");

    const txHash = await walletClient.writeContract({
      address: registry,
      abi: contraflowRegistryAbi,
      functionName: "register",
      args: [invoice, debtorSignature, creditorSignature],
      account: walletClient.account,
      chain: walletClient.chain,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`register() tx ${txHash} reverted (status: ${receipt.status})`);
    }

    return { invoiceId, txHash, blockNumber: receipt.blockNumber };
  }

  const callData = encodeFunctionData({
    abi: contraflowRegistryAbi,
    functionName: "register",
    args: [invoice, debtorSignature, creditorSignature],
  });

  const { txHash, blockNumber } = await submitContractExecutionViaDcw({
    apiKey: signer.apiKey,
    entitySecret: signer.entitySecret,
    walletId: signer.walletId,
    contractAddress: registry,
    callData,
    feeLevel: signer.feeLevel,
    pollIntervalMs: signer.pollIntervalMs,
    timeoutMs: signer.timeoutMs,
  });

  return { invoiceId, txHash, blockNumber };
}

/// End-to-end Attest-screen flow: resolves the next valid nonce for each of the fixture's three
/// (debtor, creditor) pairs, signs all three attestations, and submits them in sequence — kept
/// sequential (not `Promise.all`) so a later invoice's nonce read reflects any earlier one this
/// same call just confirmed, matching the strictly-sequential-nonce requirement.
export async function registerFixtureInvoices(params: {
  publicClient: PublicClient;
  signer: OperatorSigner;
  registry: Address;
  currency: Address;
  chainId: bigint;
  roles: FixtureRoleAddresses;
  privateKeys: { northwind: Hex; meridian: Hex; atlas: Hex };
  /// Defaults to `defaultComplianceProvider()` per `registerInvoice`, applied to each fixture
  /// invoice individually.
  complianceProvider?: ComplianceProvider;
}): Promise<RegisterResult[]> {
  const { publicClient, signer, registry, currency, chainId, roles, privateKeys, complianceProvider } = params;
  const results: RegisterResult[] = [];

  // Resolve nonces up front against current chain state; re-resolved to `undefined` gaps aren't
  // possible here since each fixture pair (northwind->meridian, meridian->atlas, atlas->northwind)
  // is distinct, so none of these three register() calls can race each other's nonce.
  const nextNonces = {
    "northwind->meridian": await readNextNonce(publicClient, registry, roles.northwind, roles.meridian),
    "meridian->atlas": await readNextNonce(publicClient, registry, roles.meridian, roles.atlas),
    "atlas->northwind": await readNextNonce(publicClient, registry, roles.atlas, roles.northwind),
  } as const;

  const fixtures = buildFixtureAttestations({ roles, currency, registry, chainId, nextNonces });

  for (const { label, attestation, debtorRole, creditorRole } of fixtures) {
    const { debtorSignature, creditorSignature } = await signAttestation(
      attestation,
      privateKeys[debtorRole],
      privateKeys[creditorRole],
    );

    const { invoiceId, txHash, blockNumber } = await registerInvoice({
      publicClient,
      signer,
      registry,
      invoice: attestation,
      debtorSignature,
      creditorSignature,
      complianceProvider,
    });

    results.push({ label, invoiceId, txHash, blockNumber });
  }

  return results;
}
