/// Two passes, run after API requests, after web-app obligation actions, and from the cron job:
/// 1. fan out: each recorded change becomes one event per tenant holding a read permission from a
///    party it touches (the event names only the parties that tenant may see);
/// 2. deliver: due events are POSTed, signed, and retried with backoff for up to 3 days.
/// A Redis lock keeps two runs from overlapping.

import type { Address, Hex } from "viem";
import {
  eventTypeFor,
  RETRY_WINDOW_SECONDS,
  retryDelaySeconds,
  SIGNATURE_HEADER,
  signatureHeader,
  type WebhookEventType,
} from "./webhooks";

export interface PendingChange {
  changeId: string;
  kind: "obligation" | "certificate";
  refId: string;
  chainId: string;
  status: string;
}

export interface ChangeContext {
  parties: Address[];
  /// The certificate's short-link token, which API calls take.
  token?: string;
}

export interface DueEvent {
  eventId: string;
  tenantId: Hex;
  body: string;
  attempts: number;
  createdAt: Date;
  url: string;
  secrets: string[];
}

export type AttemptOutcome =
  | { kind: "delivered" }
  | { kind: "retry"; nextAt: Date }
  | { kind: "failed" }
  | { kind: "suppressed" };

export interface WebhookStore {
  /// Leases up to `limit` unprocessed changes; a lease that isn't completed lapses and is retried.
  claimChanges(limit: number): Promise<PendingChange[]>;
  completeChange(changeId: string): Promise<void>;
  changeContext(change: PendingChange): Promise<ChangeContext | null>;
  /// Tenants with a webhook endpoint and a live read permission from any of `parties`.
  readersOf(chainId: string, parties: Address[], nowSeconds: bigint): Promise<{ tenantId: Hex; parties: Address[] }[]>;
  /// Does nothing if the event already exists, so re-running a change never duplicates events.
  insertEvent(event: { eventId: string; tenantId: Hex; type: WebhookEventType; body: string }): Promise<void>;
  /// Leases up to `limit` due events so a concurrent run can't send them too.
  claimDueEvents(limit: number): Promise<DueEvent[]>;
  /// Rechecks tenant status and live read permissions for every party named in the event.
  hasCurrentReadAccess(event: DueEvent, nowSeconds: bigint): Promise<boolean>;
  recordAttempt(eventId: string, attempt: number, result: { statusCode: number | null; error: string | null }, outcome: AttemptOutcome): Promise<void>;
}

export type Poster = (url: string, body: string, headers: Record<string, string>) => Promise<number>;

const CHANGE_BATCH = 200;
const DELIVERY_BATCH = 25;

/// Deterministic, so a change fanned out twice (after a crash) yields the same event IDs.
export function eventIdFor(changeId: string, tenantId: Hex): string {
  return `evt_${changeId}_${tenantId.slice(2, 18).toLowerCase()}`;
}

export async function fanOutChanges(store: WebhookStore, now: Date): Promise<number> {
  let created = 0;
  for (const change of await store.claimChanges(CHANGE_BATCH)) {
    const type = eventTypeFor(change.kind, change.status);
    const context = type ? await store.changeContext(change) : null;
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
    for (const reader of type && context ? await store.readersOf(change.chainId, context.parties, nowSeconds) : []) {
      const eventId = eventIdFor(change.changeId, reader.tenantId);
      const data =
        change.kind === "obligation"
          ? { obligationId: change.refId, parties: reader.parties }
          : { certificateId: change.refId, token: context?.token, status: change.status, parties: reader.parties };
      const body = JSON.stringify({ id: eventId, type, created: Math.floor(now.getTime() / 1000), chainId: change.chainId, data });
      await store.insertEvent({ eventId, tenantId: reader.tenantId, type: type!, body });
      created++;
    }
    await store.completeChange(change.changeId);
  }
  return created;
}

export async function deliverDue(
  store: WebhookStore,
  now: Date,
  post: Poster,
): Promise<{ delivered: number; failed: number; suppressed?: number }> {
  let delivered = 0;
  let failed = 0;
  let suppressed = 0;
  for (const event of await store.claimDueEvents(DELIVERY_BATCH)) {
    const attempt = event.attempts + 1;
    const timestamp = Math.floor(now.getTime() / 1000);
    let statusCode: number | null = null;
    let error: string | null = null;
    let authorized: boolean;
    try {
      authorized = await store.hasCurrentReadAccess(event, BigInt(timestamp));
    } catch (e) {
      // Authorization infrastructure failures must not turn into a data disclosure. Keep the
      // event retryable and do not make the HTTP request until the permission check succeeds.
      error = `Read permission check failed: ${e instanceof Error ? e.message : String(e)}`;
      const nextAt = new Date(now.getTime() + retryDelaySeconds(attempt) * 1000);
      const expired = nextAt.getTime() - event.createdAt.getTime() > RETRY_WINDOW_SECONDS * 1000;
      const outcome: AttemptOutcome = expired ? { kind: "failed" } : { kind: "retry", nextAt };
      await store.recordAttempt(event.eventId, attempt, { statusCode, error }, outcome);
      if (expired) failed++;
      continue;
    }
    if (!authorized) {
      await store.recordAttempt(
        event.eventId,
        attempt,
        { statusCode: null, error: "Delivery suppressed because current read permission is no longer active." },
        { kind: "suppressed" },
      );
      suppressed++;
      continue;
    }
    try {
      statusCode = await post(event.url, event.body, {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: signatureHeader(event.secrets, timestamp, event.body),
        "Contraflow-Event-Id": event.eventId,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    let outcome: AttemptOutcome;
    if (statusCode !== null && statusCode >= 200 && statusCode < 300) {
      outcome = { kind: "delivered" };
      delivered++;
    } else {
      const nextAt = new Date(now.getTime() + retryDelaySeconds(attempt) * 1000);
      const expired = nextAt.getTime() - event.createdAt.getTime() > RETRY_WINDOW_SECONDS * 1000;
      outcome = expired ? { kind: "failed" } : { kind: "retry", nextAt };
      if (expired) failed++;
    }
    await store.recordAttempt(event.eventId, attempt, { statusCode, error }, outcome);
  }
  return suppressed > 0 ? { delivered, failed, suppressed } : { delivered, failed };
}

/// Redirects count as failures, like Stripe's, so a webhook is never sent somewhere unregistered.
export const fetchPoster: Poster = async (url, body, headers) => {
  const res = await fetch(url, { method: "POST", body, headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  return res.status;
};
