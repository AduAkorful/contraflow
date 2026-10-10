/// Turns a handler into a Next.js route handler: API key auth, a per-tenant rate limit that fails
/// closed, `Idempotency-Key` replay for POSTs, and JSON with bigints as decimal strings. Typed-data
/// `chainId` is a JSON number (see `typedDataResponse`); other integers stay decimal strings.

import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { checkRateLimit } from "../ratelimit/limiter";
import { ApiError, authenticate, type ApiCaller } from "./auth";
import type { ApiDeps, ApiRequest, ApiResponse } from "./handlers";
import { apiDeps, idempotency } from "./deps";
import { jsonSafe } from "./json";
import { hashApiKey } from "./keys";
import { withApiLimitBucket } from "./limitBucket";
import { operationOf } from "./operations";
import { attributedParty, statusClassOf } from "./usage";
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
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const CORS_ALLOW_HEADERS = "Authorization, Content-Type, Idempotency-Key, X-Request-Id";
const CORS_EXPOSE_HEADERS = "Allow, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, WWW-Authenticate, X-Request-Id";

function requestIdOf(request: Request): string {
  const given = request.headers.get("x-request-id");
  if (given && given.length > 0 && given.length <= 128 && /^[\x21-\x7e]+$/.test(given)) return given;
  return randomUUID();
}

function corsHeaders(allowMethods: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": allowMethods,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

interface ReplyContext {
  requestId: string;
  allowMethods: string;
  rateLimit?: { limit: number; remaining: number; reset: number };
  retryAfter?: number;
  wwwAuthenticate?: boolean;
  /// Set once the caller is known. The response is counted for this tenant when it is sent.
  usage?: { tenantId: `0x${string}`; operation: string; party: string | null; keyHash: string | null };
}

function replyHeaders(ctx: ReplyContext, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Request-Id": ctx.requestId,
    ...corsHeaders(ctx.allowMethods),
    ...extra,
  };
  if (ctx.rateLimit) {
    headers["RateLimit-Limit"] = String(ctx.rateLimit.limit);
    headers["RateLimit-Remaining"] = String(ctx.rateLimit.remaining);
    headers["RateLimit-Reset"] = String(ctx.rateLimit.reset);
  }
  if (ctx.retryAfter !== undefined) headers["Retry-After"] = String(ctx.retryAfter);
  if (ctx.wwwAuthenticate) headers["WWW-Authenticate"] = 'Bearer realm="Contraflow API"';
  return headers;
}

/// Counts the response against the tenant, off the response path. Best-effort and isolated: a
/// failed count must never change what the caller receives.
function countUsage(ctx: ReplyContext, status: number, body: unknown) {
  const usage = ctx.usage;
  if (!usage) return;
  const errorCode =
    status >= 400 && body && typeof body === "object" && typeof (body as { error?: { code?: unknown } }).error?.code === "string"
      ? ((body as { error: { code: string } }).error.code)
      : "";
  ctx.usage = undefined;
  after(async () => {
    try {
      await apiDeps().recordUsage?.({
        tenantId: usage.tenantId,
        operation: usage.operation,
        party: attributedParty(status, usage.party),
        statusClass: statusClassOf(status),
        errorCode,
        keyHash: usage.keyHash,
      });
    } catch (error) {
      console.error("API usage count failed", error instanceof Error ? error.message : error);
    }
  });
}

function reply(ctx: ReplyContext, status: number, body: unknown): Response {
  countUsage(ctx, status, body);
  if (status === 204) return new Response(null, { status, headers: replyHeaders(ctx) });
  return Response.json(body, { status, headers: replyHeaders(ctx) });
}

function errorReply(ctx: ReplyContext, error: ApiError): Response {
  const wwwAuthenticate = error.status === 401;
  const retryAfter = error.status === 429 && ctx.rateLimit ? Math.max(1, ctx.rateLimit.reset - Math.floor(Date.now() / 1000)) : undefined;
  return reply({ ...ctx, wwwAuthenticate, retryAfter }, error.status, { error: { code: error.code, message: error.message } });
}

export function publicReply(request: Request, status: number, body: unknown, allowMethods = "GET, OPTIONS"): Response {
  const ctx: ReplyContext = { requestId: requestIdOf(request), allowMethods };
  return reply(ctx, status, body);
}

export function preflight(request: Request, allowMethods: string): Response {
  return new Response(null, {
    status: 204,
    headers: replyHeaders({ requestId: requestIdOf(request), allowMethods }),
  });
}

export function methodNotAllowed(request: Request, allowMethods: string): Response {
  return errorReply(
    { requestId: requestIdOf(request), allowMethods },
    new ApiError(405, "method_not_allowed", `Use one of: ${allowMethods}.`),
  );
}

async function run(handler: Handler, request: Request, context: RouteContext, options: RouteOptions, allowMethods: string): Promise<Response> {
  const ctx: ReplyContext = { requestId: requestIdOf(request), allowMethods };
  try {
    const caller = await authenticate(request.headers.get("authorization"), apiDeps().store);
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
    ctx.usage = { tenantId: caller.tenantId, operation: operationOf(handler), party: null, keyHash: token ? hashApiKey(token) : null };
    return await withApiLimitBucket(caller.tenantId, () => runAuthenticated(handler, request, context, options, caller, ctx));
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return errorReply(ctx, error);
    if (request.method === "POST" && request.headers.has("idempotency-key")) {
      return errorReply(ctx, new ApiError(500, "internal_error", "The request result is uncertain. Keep this Idempotency-Key and contact support before retrying with a new key."));
    }
    if (error instanceof ApiError) return errorReply(ctx, error);
    console.error("API request failed", error);
    return errorReply(ctx, new ApiError(500, "internal_error", "Something went wrong."));
  }
}

async function runAuthenticated(
  handler: Handler,
  request: Request,
  context: RouteContext,
  options: RouteOptions,
  caller: ApiCaller,
  ctx: ReplyContext,
): Promise<Response> {
  // Whatever this request changes goes out to webhooks once the response is sent. Only for
  // authenticated calls, so junk traffic can't drive the pipeline.
  after(runWebhookPipelineQuietly);

  try {
    const limit = await checkRateLimit(`api:tenant:${caller.tenantId}`, TENANT_LIMIT.max, TENANT_LIMIT.windowSeconds);
    ctx.rateLimit = { limit: TENANT_LIMIT.max, remaining: limit.remaining, reset: limit.reset };
    if (!limit.allowed) throw new ApiError(429, "rate_limited", "Too many requests. Slow down and retry.");
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
  if (ctx.usage) {
    const fromBody = body && typeof body === "object" ? (body as { party?: unknown }).party : undefined;
    // Next passes no params object to a route without dynamic segments.
    const candidate = req.params?.address ?? req.query.get("party") ?? fromBody;
    ctx.usage.party = typeof candidate === "string" ? candidate : null;
  }

  const key = request.method === "POST" ? request.headers.get("idempotency-key") : null;
  if (key === null) {
    const res = await handler(caller, req, apiDeps());
    return reply(ctx, res.status, jsonSafe(res.body));
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
          return reply(ctx, recovered.status, safe);
        }
      } catch {
        // The original request may still be running; a parse error here must not look like a
        // finished refusal.
      }
    }
    throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is pending and hasn't been reconciled. Keep the same key and contact support before creating a new request.");
  }
  if (claim.kind === "replay") return reply(ctx, claim.status, claim.body);
  req.idempotency = { key, requestHash, leaseToken: claim.leaseToken };

  try {
    const res = await handler(caller, req, apiDeps());
    const safe = jsonSafe(res.body);
    await idempotency.complete(caller.tenantId, key, res.status, safe, claim.leaseToken);
    return reply(ctx, res.status, safe);
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

export function route(handler: Handler, options: RouteOptions = {}, allowMethods = "GET, POST, DELETE, OPTIONS") {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    try {
      return await run(handler, request, context, options, allowMethods);
    } catch (error) {
      const ctx: ReplyContext = { requestId: requestIdOf(request), allowMethods };
      if (error instanceof ApiError && error.status < 500) return errorReply(ctx, error);
      if (request.method === "POST" && request.headers.has("idempotency-key")) {
        return errorReply(ctx, new ApiError(500, "internal_error", "The request result is uncertain. Keep this Idempotency-Key and contact support before retrying with a new key."));
      }
      if (error instanceof ApiError) return errorReply(ctx, error);
      console.error("API request failed", error);
      return errorReply(ctx, new ApiError(500, "internal_error", "Something went wrong."));
    }
  };
}

type MethodEntry = Handler | { handler: Handler; options?: RouteOptions };

export function apiMethods(handlers: Partial<Record<HttpMethod, MethodEntry>>) {
  const allowedList = [...Object.keys(handlers), "OPTIONS"].join(", ");
  const out: Record<string, (request: Request, context: RouteContext) => Promise<Response>> = {
    OPTIONS: (request) => Promise.resolve(preflight(request, allowedList)),
  };
  for (const method of HTTP_METHODS) {
    const entry = handlers[method];
    if (!entry) {
      out[method] = (request) => Promise.resolve(methodNotAllowed(request, allowedList));
    } else if (typeof entry === "function") {
      out[method] = route(entry, {}, allowedList);
    } else {
      out[method] = route(entry.handler, entry.options ?? {}, allowedList);
    }
  }
  return out as {
    GET: (request: Request, context: RouteContext) => Promise<Response>;
    POST: (request: Request, context: RouteContext) => Promise<Response>;
    PUT: (request: Request, context: RouteContext) => Promise<Response>;
    PATCH: (request: Request, context: RouteContext) => Promise<Response>;
    DELETE: (request: Request, context: RouteContext) => Promise<Response>;
    OPTIONS: (request: Request, context: RouteContext) => Promise<Response>;
  };
}
