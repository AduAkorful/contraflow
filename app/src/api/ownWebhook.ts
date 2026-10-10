/// Self-serve webhook endpoint for a tenant, reached by its signed-in owner (the app) or by its API
/// key (`/webhooks/endpoint`). One endpoint per tenant. The signing
/// secret is returned once, to the action that created or rolled it; only the endpoint's owner
/// can change it, and a suspended tenant can't.

import { randomBytes } from "node:crypto";
import type { Hex } from "viem";
import { checkResolvedHost, checkWebhookUrl, type ResolveAll } from "./webhookUrl";

export interface OwnWebhookView {
  url: string;
  /// ISO time until which the previous secret also signs, after a roll.
  rollingUntil: string | null;
}

export interface OwnDeliveryView {
  eventId: string;
  type: string;
  status: "pending" | "delivered" | "failed" | "suppressed";
  attempts: number;
  createdAt: string;
  statusCode: number | null;
  error: string | null;
}

export type SaveOutcome = "saved" | "no_tenant" | "suspended";
export type RollOutcome = "rolled" | "no_endpoint" | "no_tenant" | "suspended";
export type RemoveOutcome = "removed" | "no_endpoint";

export interface OwnWebhookStore {
  get(owner: string): Promise<OwnWebhookView | null>;
  save(owner: string, url: string, secret: string): Promise<SaveOutcome>;
  roll(owner: string, secret: string): Promise<RollOutcome>;
  remove(owner: string): Promise<RemoveOutcome>;
  tenant(owner: string): Promise<{ tenantId: Hex; status: "active" | "suspended" } | null>;
  recent(owner: string): Promise<OwnDeliveryView[]>;
}

export type OwnWebhookResult = { ok: true; secret?: string } | { ok: false; error: string };

const UNAVAILABLE = "Webhooks aren't available right now.";
const NEED_KEY = "Create an API key first. Your tenant is created with your first key.";

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/// `subject` is whatever the store keys on: the owner's address in the app, the tenant id in the API.
function subjectLower(subject: string): string {
  return subject.toLowerCase();
}

function saveError(outcome: Exclude<SaveOutcome, "saved">): string {
  return outcome === "suspended" ? "This API access is suspended." : NEED_KEY;
}

export async function setOwnWebhook(
  owner: string,
  rawUrl: string,
  store: OwnWebhookStore,
  options: { allowLocalHttp?: boolean; resolve?: ResolveAll; secret?: () => string } = {},
): Promise<OwnWebhookResult> {
  const checked = checkWebhookUrl(rawUrl, { allowLocalHttp: options.allowLocalHttp });
  if (!checked.ok) return checked;
  if (checked.url.protocol === "https:") {
    const resolved = await checkResolvedHost(checked.url.hostname, options.resolve);
    if (!resolved.ok) return resolved;
  }
  const secret = (options.secret ?? newWebhookSecret)();
  const outcome = await store.save(subjectLower(owner), checked.url.toString(), secret);
  if (outcome !== "saved") return { ok: false, error: saveError(outcome) };
  return { ok: true, secret };
}

export async function rollOwnWebhookSecret(owner: string, store: OwnWebhookStore, secret: () => string = newWebhookSecret): Promise<OwnWebhookResult> {
  const value = secret();
  const outcome = await store.roll(subjectLower(owner), value);
  if (outcome === "rolled") return { ok: true, secret: value };
  if (outcome === "no_endpoint") return { ok: false, error: "Add an endpoint first." };
  return { ok: false, error: outcome === "suspended" ? "This API access is suspended." : NEED_KEY };
}

export async function removeOwnWebhook(owner: string, store: OwnWebhookStore): Promise<OwnWebhookResult> {
  const outcome = await store.remove(subjectLower(owner));
  return outcome === "removed" ? { ok: true } : { ok: false, error: "There's no endpoint to remove." };
}

export interface TestWebhookDeps {
  store: OwnWebhookStore;
  enqueue(tenantId: Hex, chainId: number): Promise<{ eventId: string } | { error: "no_endpoint" }>;
  chainId: number;
}

export async function testOwnWebhook(owner: string, deps: TestWebhookDeps): Promise<OwnWebhookResult> {
  const tenant = await deps.store.tenant(subjectLower(owner));
  if (!tenant) return { ok: false, error: NEED_KEY };
  if (tenant.status !== "active") return { ok: false, error: "This API access is suspended." };
  const queued = await deps.enqueue(tenant.tenantId, deps.chainId);
  if ("error" in queued) return { ok: false, error: "Add an endpoint first." };
  return { ok: true };
}

export { UNAVAILABLE as OWN_WEBHOOK_UNAVAILABLE };
