"use server";

/// Server Actions for Mode B obligations and netting certificates. Each one takes the caller's
/// address from the verified session, never from a parameter; the logic and its access rules
/// live in `src/obligations/service.ts` and `src/obligations/certificates.ts`.

import { getSession } from "@/src/session/getSession";
import * as service from "@/src/obligations/service";
import type { CreateProposalInput, Result } from "@/src/obligations/service";
import { certificateService } from "@/src/obligations/certificateDefaults";
import { after } from "next/server";
import { runWebhookPipelineQuietly } from "@/src/api/webhookRunner";

/// Anything these actions change (or sync from the ledger) reaches API tenants' webhooks once the
/// response is sent.
function notifyWebhooks() {
  after(runWebhookPipelineQuietly);
}

const SIGN_IN_FIRST = { ok: false as const, error: "Sign in first." };

export async function createProposal(input: CreateProposalInput) {
  notifyWebhooks();
  const session = await getSession();
  return session ? service.createProposal(session.address, input) : SIGN_IN_FIRST;
}

export async function getProposal(token: string) {
  const session = await getSession();
  return session ? service.getProposal(session.address, token) : SIGN_IN_FIRST;
}

export async function acceptProposal(token: string, signature: string): Promise<Result> {
  notifyWebhooks();
  const session = await getSession();
  return session ? service.acceptProposal(session.address, token, signature) : SIGN_IN_FIRST;
}

export async function withdrawProposal(token: string): Promise<Result> {
  notifyWebhooks();
  const session = await getSession();
  return session ? service.withdrawProposal(session.address, token) : SIGN_IN_FIRST;
}

export async function closeObligation(obligationId: string): Promise<Result> {
  notifyWebhooks();
  const session = await getSession();
  return session ? certificateService().closeObligation(session.address, obligationId) : SIGN_IN_FIRST;
}

export async function listMyObligations() {
  notifyWebhooks();
  const session = await getSession();
  return session ? service.listMine(session.address) : SIGN_IN_FIRST;
}

export async function findNettingLoop() {
  notifyWebhooks();
  const session = await getSession();
  return session ? certificateService().findAndProposeLoop(session.address) : SIGN_IN_FIRST;
}

export async function getCertificate(token: string) {
  notifyWebhooks();
  const session = await getSession();
  return session ? certificateService().getCertificateView(session.address, token) : SIGN_IN_FIRST;
}

export async function signCertificate(token: string, signature: string): Promise<Result> {
  notifyWebhooks();
  const session = await getSession();
  return session ? certificateService().submitCertificateSignature(session.address, token, signature) : SIGN_IN_FIRST;
}

export async function declineCertificate(token: string): Promise<Result> {
  notifyWebhooks();
  const session = await getSession();
  return session ? certificateService().declineCertificate(session.address, token) : SIGN_IN_FIRST;
}

export async function recordCertificateApplied(token: string, txHash: string) {
  notifyWebhooks();
  const session = await getSession();
  return session ? certificateService().recordApplicationTx(session.address, token, txHash) : SIGN_IN_FIRST;
}

export async function exportCertificate(token: string) {
  const session = await getSession();
  return session ? certificateService().exportCertificate(session.address, token) : SIGN_IN_FIRST;
}
