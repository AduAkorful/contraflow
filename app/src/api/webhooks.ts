/// Webhook signing and scheduling, following Stripe's documented scheme: a
/// `Contraflow-Signature: t=<unix>,v1=<hex>` header whose `v1` is HMAC-SHA256 over `"<t>.<body>"`.
/// While a rolled secret's old value is still valid, both signatures are sent.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "Contraflow-Signature";
/// Receivers should reject anything signed more than this long ago (Stripe's default).
export const SIGNATURE_TOLERANCE_SECONDS = 300;
/// Deliveries stop and are marked failed once an event is this old (Stripe retries for 3 days).
export const RETRY_WINDOW_SECONDS = 3 * 24 * 60 * 60;
const FIRST_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 6 * 60 * 60;

export type WebhookEventType =
  | "obligation.recorded"
  | "certificate.proposed"
  | "certificate.ready"
  | "certificate.applied"
  | "certificate.expired"
  | "certificate.cancelled";

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function signatureHeader(secrets: string[], timestamp: number, body: string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${hmac(s, timestamp, body)}`)].join(",");
}

/// The receiver side, published so tenants can copy it: any matching `v1` within the tolerance.
export function verifySignature(header: string, body: string, secret: string, nowSeconds: number): boolean {
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isInteger(t) || Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(hmac(secret, t, body), "hex");
  return parts
    .filter(([k]) => k === "v1")
    .some(([, v]) => {
      const given = Buffer.from(v ?? "", "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

/// Seconds until the next attempt after `attempts` failures: 1, 2, 4… minutes, capped at 6 hours.
export function retryDelaySeconds(attempts: number): number {
  return Math.min(FIRST_RETRY_SECONDS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_SECONDS);
}

/// The event a recorded change becomes, or null for a change tenants aren't told about. Obligation
/// changes are only ever inserts; a certificate starts as `collecting` and never returns to it.
export function eventTypeFor(kind: "obligation" | "certificate", status: string): WebhookEventType | null {
  if (kind === "obligation") return "obligation.recorded";
  switch (status) {
    case "collecting":
      return "certificate.proposed";
    case "ready":
      return "certificate.ready";
    case "applied":
      return "certificate.applied";
    case "expired":
      return "certificate.expired";
    case "abandoned":
      return "certificate.cancelled";
    default:
      return null;
  }
}
