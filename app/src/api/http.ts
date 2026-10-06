/// Turns a handler into a Next.js route handler: API key auth, a per-tenant rate limit that fails
/// closed, `Idempotency-Key` replay for POSTs, and JSON with bigints as decimal strings. Typed-data
/// `chainId` is a JSON number (see `typedDataResponse`); other integers stay strings.

import { createHash } from "node:crypto";
import { after } from "next/server";
import { checkRateLimit } from "../ratelimit/limiter";
import { ApiError, authenticate, type ApiCaller } from "./auth";
import type { ApiDeps, ApiRequest, ApiResponse } from "./handlers";
import { apiDeps, idempotency } from "./deps";
import { jsonSafe } from "./json";
import { runWebhookPipelineQuietly } from "./webhookRunner";

type Handler = (caller: ApiCaller, req: ApiRequest, deps: ApiDeps) => Promise<ApiResponse>;
type RouteContext = { params: Promise<Record<string, string>> };
type RouteOptions = {
  /// Only POST /permissions may reclaim an expired lease and re-run: its insert is atomic with
  /// the idempotency row. Other routes look up an existing effect instead.
  recoverStaleIdempotency?: boolean;
  /// When a key is still `in_progress`, return the existing effect if this finds it. Never
  /// re-executes the mutation.
  recoverFromEffect?: (caller: ApiCaller, req: ApiRequest, deps: ApiDeps) => Promise<ApiResponse | null>;
};

export type { Handler };
export { jsonSafe };

const TENANT_LIMIT = { max: 600, windowSeconds: 60 };
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

function reply(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function errorReply(error: ApiError): Response {
  return reply(error.status, { error: { code: error.code, message: error.message } });
}

async function run(handler: Handler, request: Request, context: RouteContext, options: RouteOptions): Promise<Response> {
  const caller = await authenticate(request.headers.get("authorization"), apiDeps().store);
  // Whatever this request changes goes out to webhooks once the response is sent. Only for
  // authenticated calls, so junk traffic can't drive the pipeline.
  after(runWebhookPipelineQuietly);

  try {
    const { allowed } = await checkRateLimit(`api:tenant:${caller.tenantId}`, TENANT_LIMIT.max, TENANT_LIMIT.windowSeconds);
    if (!allowed) throw new ApiError(429, "rate_limited", "Too many requests. Slow down and retry.");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // The limiter protects the chain RPC and the explorer as much as the database, so an
    // unreachable limiter fails closed rather than letting traffic through unmetered.
    throw new ApiError(503, "unavailable", "The API is temporarily unavailable.");
  }

  const raw = request.method === "POST" ? await request.text() : "";
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "invalid_json", "The request body isn't valid JSON.");
    }
  }
  const req: ApiRequest = { params: await context.params, query: new URL(request.url).searchParams, body };

  const key = request.method === "POST" ? request.headers.get("idempotency-key") : null;
  if (key === null) {
    const res = await handler(caller, req, apiDeps());
    return reply(res.status, jsonSafe(res.body));
  }
  if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must be 1 to 255 characters.");
  }

  const requestHash = createHash("sha256").update(`${request.method} ${new URL(request.url).pathname}\n${raw}`).digest("hex");
  const claim = await idempotency.claim(caller.tenantId, key, requestHash, options.recoverStaleIdempotency === true);
  if (claim.kind === "conflict") throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was used for a different request.");
  if (claim.kind === "in_progress") {
    if (options.recoverFromEffect) {
      try {
        const recovered = await options.recoverFromEffect(caller, req, apiDeps());
        if (recovered) {
          const safe = jsonSafe(recovered.body);
          await idempotency.completeFromEffect(caller.tenantId, key, requestHash, recovered.status, safe);
          return reply(recovered.status, safe);
        }
      } catch {
        // The original request may still be running; a parse error here must not look like a
        // finished refusal.
      }
    }
    throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is pending and hasn't been reconciled. Keep the same key and contact support before creating a new request.");
  }
  if (claim.kind === "replay") return reply(claim.status, claim.body);
  req.idempotency = { key, requestHash, leaseToken: claim.leaseToken };

  try {
    const res = await handler(caller, req, apiDeps());
    const safe = jsonSafe(res.body);
    await idempotency.complete(caller.tenantId, key, res.status, safe, claim.leaseToken);
    return reply(res.status, safe);
  } catch (error) {
    // A deterministic 4xx is replayed like any other. Unexpected/server failures keep the
    // reservation because the request may have committed a durable mutation before failing.
    if (error instanceof ApiError && error.status < 500) {
      const safe = { error: { code: error.code, message: error.message } };
      await idempotency.complete(caller.tenantId, key, error.status, safe, claim.leaseToken);
    }
    // Unexpected/server failures keep the reservation. The request may have committed a durable
    // mutation before the error surfaced, so releasing here could make a retry execute it twice.
    throw error;
  }
}

export function route(handler: Handler, options: RouteOptions = {}) {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    try {
      return await run(handler, request, context, options);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) return errorReply(error);
      if (request.method === "POST" && request.headers.has("idempotency-key")) {
        return errorReply(new ApiError(500, "internal_error", "The request result is uncertain. Keep this Idempotency-Key and contact support before retrying with a new key."));
      }
      if (error instanceof ApiError) return errorReply(error);
      console.error("API request failed", error);
      return errorReply(new ApiError(500, "internal_error", "Something went wrong."));
    }
  };
}
