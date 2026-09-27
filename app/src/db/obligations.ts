/// Read/write helpers for `netting_proposals` and `netting_obligations`. A plain data-access layer
/// like `documents.ts`: access control (only the two named parties) lives in the Server Actions
/// that call these. Addresses and hex are stored lowercase.

import type { Hex } from "viem";
import { sql, withDbRetry } from "./client";

export type ProposalStatus = "open" | "accepted" | "withdrawn";
/// `out_of_sync`: the stored state disagrees with the ledger, so it is never netted from it again.
export type ObligationStatus = "active" | "closed" | "out_of_sync";

export interface ProposalRow {
  token: string;
  obligationId: string;
  chainId: string;
  ledger: string;
  proposer: string;
  counterparty: string;
  proposerRole: "debtor" | "creditor";
  /// `serializeObligation`'s JSON shape; parse it before use, never trust it as typed.
  obligation: unknown;
  document: unknown;
  proposerSignature: string;
  status: ProposalStatus;
  createdAt: Date;
  expiresAt: Date;
}

export interface ObligationRow {
  obligationId: string;
  chainId: string;
  ledger: string;
  documentHash: string;
  debtor: string;
  creditor: string;
  currency: string;
  amount: string;
  maturity: string;
  earlyNetConsent: boolean;
  salt: string;
  debtorSignature: string;
  creditorSignature: string;
  description: string;
  remaining: string;
  blinding: string;
  status: ObligationStatus;
  createdBy: string;
  createdAt: Date;
}

/// A different obligation for the same document and pair already exists.
export class DuplicateObligationError extends Error {
  constructor() {
    super("This document is already recorded as an obligation between these two parties.");
    this.name = "DuplicateObligationError";
  }
}

const PROPOSAL_LIFETIME = "30 days";

function toProposalRow(r: Record<string, unknown>): ProposalRow {
  return {
    token: r.token as string,
    obligationId: r.obligation_id as string,
    chainId: r.chain_id as string,
    ledger: r.ledger as string,
    proposer: r.proposer as string,
    counterparty: r.counterparty as string,
    proposerRole: r.proposer_role as "debtor" | "creditor",
    obligation: r.obligation,
    document: r.document,
    proposerSignature: r.proposer_signature as string,
    status: r.status as ProposalStatus,
    createdAt: new Date(r.created_at as string),
    expiresAt: new Date(r.expires_at as string),
  };
}

export function toObligationRow(r: Record<string, unknown>): ObligationRow {
  return {
    obligationId: r.obligation_id as string,
    chainId: r.chain_id as string,
    ledger: r.ledger as string,
    documentHash: r.document_hash as string,
    debtor: r.debtor as string,
    creditor: r.creditor as string,
    currency: r.currency as string,
    amount: r.amount as string,
    maturity: r.maturity as string,
    earlyNetConsent: r.early_net_consent as boolean,
    salt: r.salt as string,
    debtorSignature: r.debtor_signature as string,
    creditorSignature: r.creditor_signature as string,
    description: r.description as string,
    remaining: r.remaining as string,
    blinding: r.blinding as string,
    status: r.status as ObligationStatus,
    createdBy: r.created_by as string,
    createdAt: new Date(r.created_at as string),
  };
}

function isDocumentConflict(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string };
  return e?.code === "23505" && e.constraint === "netting_obligations_document_unique";
}

export interface InsertProposalInput {
  token: string;
  obligationId: Hex;
  chainId: string;
  ledger: string;
  proposer: string;
  counterparty: string;
  proposerRole: "debtor" | "creditor";
  obligation: unknown;
  document: unknown;
  proposerSignature: Hex;
}

/// Stores a proposal and returns the token it's stored under. Idempotent per obligation id: a
/// retry (including one after a commit whose response was lost) returns the existing token.
export async function insertProposal(input: InsertProposalInput): Promise<string> {
  await withDbRetry(async () => {
    const db = sql();
    await db`
      INSERT INTO netting_proposals (token, obligation_id, chain_id, ledger, proposer, counterparty, proposer_role,
        obligation, document, proposer_signature, expires_at)
      VALUES (${input.token}, ${input.obligationId.toLowerCase()}, ${input.chainId}, ${input.ledger.toLowerCase()},
        ${input.proposer.toLowerCase()}, ${input.counterparty.toLowerCase()}, ${input.proposerRole},
        ${JSON.stringify(input.obligation)}::jsonb, ${JSON.stringify(input.document)}::jsonb,
        ${input.proposerSignature.toLowerCase()}, now() + ${PROPOSAL_LIFETIME}::interval)
      ON CONFLICT DO NOTHING
    `;
  });
  const stored = await getProposalByObligationId(input.obligationId);
  if (!stored) throw new Error("insertProposal: the proposal was not stored");
  return stored.token;
}

export async function getProposalByObligationId(obligationId: string): Promise<ProposalRow | null> {
  return withDbRetry(async () => {
    const rows = (await sql()`
      SELECT * FROM netting_proposals WHERE obligation_id = ${obligationId.toLowerCase()}
    `) as Record<string, unknown>[];
    return rows[0] ? toProposalRow(rows[0]) : null;
  });
}

export async function getProposalByToken(token: string): Promise<ProposalRow | null> {
  return withDbRetry(async () => {
    const rows = (await sql()`SELECT * FROM netting_proposals WHERE token = ${token}`) as Record<string, unknown>[];
    return rows[0] ? toProposalRow(rows[0]) : null;
  });
}

/// An obligation for this exact document and pair, whatever its status.
export async function obligationExistsForDocument(params: {
  chainId: string;
  ledger: string;
  debtor: string;
  creditor: string;
  documentHash: string;
}): Promise<boolean> {
  return withDbRetry(async () => {
    const rows = (await sql()`
      SELECT 1 FROM netting_obligations
      WHERE chain_id = ${params.chainId} AND ledger = ${params.ledger.toLowerCase()}
        AND debtor = ${params.debtor.toLowerCase()} AND creditor = ${params.creditor.toLowerCase()}
        AND document_hash = ${params.documentHash.toLowerCase()}
      LIMIT 1
    `) as unknown[];
    return rows.length > 0;
  });
}

export interface InsertObligationInput {
  obligationId: Hex;
  chainId: string;
  ledger: string;
  documentHash: Hex;
  debtor: string;
  creditor: string;
  currency: string;
  amount: bigint;
  maturity: bigint;
  earlyNetConsent: boolean;
  salt: Hex;
  debtorSignature: Hex;
  creditorSignature: Hex;
  description: string;
  /// The zero hash: a new obligation has never been netted.
  blinding: Hex;
  createdBy: string;
}

/// Inserts the obligation and marks its proposal accepted, atomically. Idempotent: a repeat for
/// the same obligation id changes nothing. Throws `DuplicateObligationError` if a different
/// obligation already covers the same document for the same pair.
export async function acceptProposalWithObligation(token: string, input: InsertObligationInput): Promise<void> {
  try {
    await withDbRetry(async () => {
      const db = sql();
      await db.transaction([
        db`
          INSERT INTO netting_obligations (obligation_id, chain_id, ledger, document_hash, debtor, creditor, currency,
            amount, maturity, early_net_consent, salt, debtor_signature, creditor_signature, description, remaining,
            blinding, created_by)
          VALUES (${input.obligationId.toLowerCase()}, ${input.chainId}, ${input.ledger.toLowerCase()},
            ${input.documentHash.toLowerCase()}, ${input.debtor.toLowerCase()}, ${input.creditor.toLowerCase()},
            ${input.currency}, ${input.amount.toString()}, ${input.maturity.toString()}, ${input.earlyNetConsent},
            ${input.salt.toLowerCase()}, ${input.debtorSignature.toLowerCase()}, ${input.creditorSignature.toLowerCase()},
            ${input.description}, ${input.amount.toString()}, ${input.blinding.toLowerCase()},
            ${input.createdBy.toLowerCase()})
          ON CONFLICT (obligation_id) DO NOTHING
        `,
        db`
          UPDATE netting_proposals SET status = 'accepted', closed_by = ${input.createdBy.toLowerCase()}, closed_at = now()
          WHERE token = ${token} AND status = 'open'
        `,
      ]);
    });
  } catch (error) {
    if (isDocumentConflict(error)) throw new DuplicateObligationError();
    throw error;
  }
}

export async function markProposalWithdrawn(token: string, by: string): Promise<void> {
  await withDbRetry(async () => {
    await sql()`
      UPDATE netting_proposals SET status = 'withdrawn', closed_by = ${by.toLowerCase()}, closed_at = now()
      WHERE token = ${token} AND status = 'open'
    `;
  });
}

export async function getObligationById(obligationId: string): Promise<ObligationRow | null> {
  return withDbRetry(async () => {
    const rows = (await sql()`
      SELECT * FROM netting_obligations WHERE obligation_id = ${obligationId.toLowerCase()}
    `) as Record<string, unknown>[];
    return rows[0] ? toObligationRow(rows[0]) : null;
  });
}

export async function listObligationsForParty(address: string): Promise<ObligationRow[]> {
  return withDbRetry(async () => {
    const a = address.toLowerCase();
    const rows = (await sql()`
      SELECT * FROM netting_obligations WHERE debtor = ${a} OR creditor = ${a} ORDER BY created_at DESC LIMIT 200
    `) as Record<string, unknown>[];
    return rows.map(toObligationRow);
  });
}

/// Open, unexpired proposals the address is part of, either side.
export async function listOpenProposalsForParty(address: string): Promise<ProposalRow[]> {
  return withDbRetry(async () => {
    const a = address.toLowerCase();
    const rows = (await sql()`
      SELECT * FROM netting_proposals
      WHERE (proposer = ${a} OR counterparty = ${a}) AND status = 'open' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 200
    `) as Record<string, unknown>[];
    return rows.map(toProposalRow);
  });
}
