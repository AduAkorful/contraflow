/// OpenAPI 3.1 document for `/api/v1`. The route at `/api/v1/openapi.json` serves this object.
/// Keep it in step with `handlers.ts` and the GitBook API page: new fields, error codes and
/// endpoints belong here in the same session.

import { WEBHOOK_EVENT_TYPES } from "./webhooks";

export const ERROR_CODES = [
  "unauthorized",
  "live_unavailable",
  "not_found",
  "rate_limited",
  "unavailable",
  "invalid_json",
  "invalid_idempotency_key",
  "idempotency_conflict",
  "idempotency_in_progress",
  "internal_error",
  "invalid_party",
  "invalid_request",
  "invalid_permission",
  "duplicate_nonce",
  "rejected",
  "not_ready",
  "chain_unavailable",
  "method_not_allowed",
  "no_webhook",
] as const;

const errorRef = { $ref: "#/components/responses/Error" as const };

function errors(...codes: string[]) {
  const out: Record<string, unknown> = {};
  for (const code of codes) out[code] = errorRef;
  return out;
}

const authErrors = errors("401", "429", "503");
const jsonErrors = { ...authErrors, ...errors("400", "404", "409", "422") };

const idempotencyKey = { $ref: "#/components/parameters/IdempotencyKey" as const };
const partyQuery = {
  name: "party",
  in: "query",
  required: true,
  schema: { $ref: "#/components/schemas/Address" },
  description: "The party you're acting for. You need its live permission with the matching scope.",
};
const tokenPath = {
  name: "token",
  in: "path",
  required: true,
  schema: { type: "string" },
};
const addressPath = {
  name: "address",
  in: "path",
  required: true,
  schema: { $ref: "#/components/schemas/Address" },
};

function ok(schema: Record<string, unknown>, status = "200") {
  return {
    [status]: {
      description: "Success",
      content: { "application/json": { schema } },
    },
  };
}

function op(spec: {
  operationId: string;
  tags: string[];
  summary: string;
  description: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}) {
  return spec;
}

export const API_INDEX = {
  name: "Contraflow API",
  version: "1.0.0",
  documentation: "/api/v1/openapi.json",
  scope: "Offchain obligations only. There is no invoice or settlement API. Applying a certificate does not post anything to a party's accounting system: the platform records the reduction in the party's own books, keyed on `certificate.applied`, and it does not by itself discharge a debt under any legal or accounting standard.",
  endpoints: [
    { method: "GET", path: "/", description: "This index" },
    { method: "GET", path: "/openapi.json", description: "OpenAPI 3.1 document" },
    { method: "GET", path: "/tenant", description: "This tenant" },
    { method: "GET", path: "/usage", description: "This tenant's call counts, keys and per-party state" },
    { method: "GET", path: "/permissions/typed-data", description: "Build a permission to sign" },
    { method: "GET", path: "/permissions", description: "List stored permissions" },
    { method: "POST", path: "/permissions", description: "Store a signed permission" },
    { method: "DELETE", path: "/permissions/{permissionId}", description: "Revoke a permission" },
    { method: "POST", path: "/obligations/proposals", description: "Propose an obligation" },
    { method: "GET", path: "/obligations/proposals/{token}", description: "Read a proposal" },
    { method: "DELETE", path: "/obligations/proposals/{token}", description: "Withdraw a proposal" },
    { method: "POST", path: "/obligations/proposals/{token}/accept", description: "Accept a proposal" },
    { method: "GET", path: "/parties/{address}/obligations", description: "List a party's obligations" },
    { method: "POST", path: "/parties/{address}/loops", description: "Find and propose a loop" },
    { method: "GET", path: "/certificates/{token}", description: "Read a certificate" },
    { method: "POST", path: "/certificates/{token}/signatures", description: "Submit a certificate signature" },
    { method: "GET", path: "/certificates/{token}/apply-transaction", description: "Unsigned apply calldata" },
    { method: "POST", path: "/certificates/{token}/transactions", description: "Report an apply transaction" },
    { method: "GET", path: "/certificates/{token}/export", description: "Export a certificate view" },
    { method: "POST", path: "/webhooks/test", description: "Enqueue a test webhook event" },
    { method: "GET", path: "/webhooks/endpoint", description: "Read the webhook endpoint and recent deliveries" },
    { method: "POST", path: "/webhooks/endpoint", description: "Set or replace the webhook endpoint" },
    { method: "DELETE", path: "/webhooks/endpoint", description: "Remove the webhook endpoint" },
    { method: "POST", path: "/webhooks/endpoint/secret", description: "Roll the signing secret" },
  ],
};

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Contraflow API",
    version: "1.0.0",
    license: { name: "Proprietary", url: "https://contraflow.vercel.app/terms" },
    description:
      "Record offchain obligations for your customers, find netting loops, collect each party's certificate signature and apply certificates on Arc. Contraflow never signs for anyone: every obligation and certificate carries the party's own signature, and you act for a party only under a permission it signed. Test keys (`cfk_test_`) use Arc testnet. List and summary responses name amounts `amountMinor` (an ISO 4217 minor-unit integer string) and `amountDisplay` (the same amount in major units). Their timestamps are unix-second strings. `chainId` is a JSON number on the tenant, an apply transaction, a webhook event, and a proposal's domain. Signed obligation documents, EIP-712 fields, and `contraflow-netting-certificate/1` files keep their own field names. In EIP-712 typed-data responses, `domain.chainId` is a JSON number and `digest` is the payload's hash; other integers in those signed payloads stay decimal strings. Authorization is case-insensitive `Bearer`. There is no invoice or settlement API.",
  },
  servers: [
    { url: "https://contraflow.vercel.app/api/v1", description: "Hosted app" },
    { url: "/api/v1", description: "Same origin" },
  ],
  tags: [
    { name: "Tenant", description: "The tenant your API key belongs to." },
    { name: "Permissions", description: "Signed, scoped, expiring permissions a party grants your tenant." },
    { name: "Obligations", description: "Offchain obligations between two parties, proposed and co-signed by them." },
    { name: "Certificates", description: "Netting loops, each party's certificate signature, and the calldata to apply one on Arc." },
    { name: "Webhooks", description: "Signed event delivery to your endpoint. `certificate.applied` is the event to key a party's bookkeeping on." },
  ],
  security: [{ apiKey: [] }],
  paths: {
    "/tenant": {
      get: op({
        operationId: "getTenant",
        tags: ["Tenant"],
        summary: "This tenant",
        description: "Name, status, key mode, chain, and whether a webhook URL is registered. No party permission required.",
        responses: { ...ok({ $ref: "#/components/schemas/Tenant" }), ...authErrors, ...errors("404") },
      }),
    },
    "/usage": {
      get: op({
        operationId: "getUsage",
        tags: ["Tenant"],
        summary: "Your usage",
        description:
          "Daily counts of this tenant's own API calls by operation, status class and error code, the last use of each key, and, per party, the permission state and webhook delivery counts. Counts only: no request contents. Days are UTC, the range is at most 90 days and defaults to the last 30, and recording started when this endpoint shipped. Counts are best-effort and can run slightly low. No party permission required.",
        parameters: [
          { name: "from", in: "query", schema: { type: "string" }, description: "yyyy-mm-dd, UTC." },
          { name: "to", in: "query", schema: { type: "string" }, description: "yyyy-mm-dd, UTC. Defaults to today." },
          { name: "party", in: "query", schema: { $ref: "#/components/schemas/Address" }, description: "Only this party." },
          { name: "cursor", in: "query", schema: { $ref: "#/components/schemas/Address" }, description: "The previous page's `nextCursor`." },
        ],
        responses: { ...ok({ $ref: "#/components/schemas/TenantUsage" }), ...authErrors, ...errors("422") },
      }),
    },
    "/permissions/typed-data": {
      get: op({
        operationId: "getPermissionTypedData",
        tags: ["Permissions"],
        summary: "Build a permission to sign",
        description: "Returns the EIP-712 typed data a party signs to grant you scopes. Validates party, scopes, expiry (at most one year) and nonce before building the payload.",
        parameters: [
          { name: "party", in: "query", required: true, schema: { $ref: "#/components/schemas/Address" } },
          {
            name: "scopes",
            in: "query",
            required: true,
            schema: { type: "integer", minimum: 1, maximum: 7 },
            description: "Bitmask: read 1, propose 2, deliverSignatures 4.",
          },
          { name: "expiresAt", in: "query", required: true, schema: { type: "string" }, description: "Unix seconds, at most one year ahead." },
          { name: "nonce", in: "query", required: true, schema: { $ref: "#/components/schemas/Bytes32" } },
        ],
        responses: { ...ok({ $ref: "#/components/schemas/TypedDataEnvelope" }), ...jsonErrors },
      }),
    },
    "/permissions": {
      get: op({
        operationId: "listPermissions",
        tags: ["Permissions"],
        summary: "List stored permissions",
        description: "Permissions this tenant holds on the key's chain. Optionally filter by party.",
        parameters: [
          { name: "party", in: "query", required: false, schema: { $ref: "#/components/schemas/Address" } },
        ],
        responses: { ...ok({ $ref: "#/components/schemas/PermissionList" }), ...authErrors, ...errors("422") },
      }),
      post: op({
        operationId: "createPermission",
        tags: ["Permissions"],
        summary: "Store a signed permission",
        description: "Verifies the party's signature (ECDSA, or ERC-1271 for a smart account) and stores the grant.",
        parameters: [idempotencyKey],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["permission", "signature"],
                properties: {
                  permission: { $ref: "#/components/schemas/PermissionGrant" },
                  signature: { $ref: "#/components/schemas/Hex" },
                },
              },
            },
          },
        },
        responses: { ...ok({ $ref: "#/components/schemas/StoredPermission" }, "201"), ...jsonErrors },
      }),
    },
    "/permissions/{permissionId}": {
      delete: op({
        operationId: "revokePermission",
        tags: ["Permissions"],
        summary: "Revoke a permission",
        description: "Stops you acting for the party under this grant.",
        parameters: [{ name: "permissionId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "No content" }, ...authErrors, ...errors("404") },
      }),
    },
    "/obligations/proposals": {
      post: op({
        operationId: "createObligationProposal",
        tags: ["Obligations"],
        summary: "Propose an obligation",
        description: "Needs the named party's `propose` scope. The obligation must already be signed by that party. `document.amount` is major units; `obligation.amount` is the same value as a minor-unit integer string.",
        parameters: [idempotencyKey],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateProposalRequest" },
            },
          },
        },
        responses: { ...ok({ $ref: "#/components/schemas/ProposalResponse" }, "201"), ...jsonErrors },
      }),
    },
    "/obligations/proposals/{token}": {
      get: op({
        operationId: "getObligationProposal",
        tags: ["Obligations"],
        summary: "Read a proposal",
        description: "Needs the party's `read` scope. Non-parties get 404.",
        parameters: [tokenPath, partyQuery],
        responses: { ...ok({ $ref: "#/components/schemas/ProposalResponse" }), ...jsonErrors },
      }),
      delete: op({
        operationId: "withdrawObligationProposal",
        tags: ["Obligations"],
        summary: "Withdraw a proposal",
        description: "Needs the proposer's `propose` scope.",
        parameters: [tokenPath, partyQuery],
        responses: { "204": { description: "No content" }, ...jsonErrors },
      }),
    },
    "/obligations/proposals/{token}/accept": {
      post: op({
        operationId: "acceptObligationProposal",
        tags: ["Obligations"],
        summary: "Accept a proposal",
        description: "Needs `deliverSignatures`. Body is `{ \"party\", \"signature\" }` — the counterparty's signature of the returned typed data.",
        parameters: [tokenPath, idempotencyKey],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["party", "signature"],
                properties: { party: { $ref: "#/components/schemas/Address" }, signature: { $ref: "#/components/schemas/Hex" } },
              },
            },
          },
        },
        responses: { ...ok({ type: "object", properties: { accepted: { type: "boolean" } } }), ...jsonErrors },
      }),
    },
    "/parties/{address}/obligations": {
      get: op({
        operationId: "listPartyObligations",
        tags: ["Obligations"],
        summary: "List a party's proposals, obligations and certificates",
        description: "Needs `read`. Stable order: proposals, then obligations, then certificates, each by id. Pass `cursor` from `nextCursor` for the next page. Default limit 50, max 100. An obligation's `remainingMinor` is what is still owed after any applied certificate.",
        parameters: [
          addressPath,
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { ...ok({ $ref: "#/components/schemas/PartyObligationsPage" }), ...jsonErrors },
      }),
    },
    "/parties/{address}/loops": {
      post: op({
        operationId: "findLoop",
        tags: ["Certificates"],
        summary: "Find and propose a loop",
        description: "Needs `propose`. Searches from this party. Applying the resulting certificate is permissionless and paid by whoever submits it.",
        parameters: [addressPath, idempotencyKey],
        responses: { ...ok({ $ref: "#/components/schemas/LoopSearch" }), ...jsonErrors },
      }),
    },
    "/certificates/{token}": {
      get: op({
        operationId: "getCertificate",
        tags: ["Certificates"],
        summary: "Read a certificate",
        description: "Needs `read`. The summary uses `wNetMinor` and `wNetDisplay`. `view` is the party's `contraflow-netting-certificate/1` file, which keeps the name `wNet`. Once `status` is `applied`, `wNetMinor` is the amount netted, for the platform to record in the party's own books.",
        parameters: [tokenPath, partyQuery],
        responses: { ...ok({ $ref: "#/components/schemas/CertificateRead" }), ...jsonErrors },
      }),
    },
    "/certificates/{token}/signatures": {
      post: op({
        operationId: "signCertificate",
        tags: ["Certificates"],
        summary: "Submit a certificate signature",
        description: "Needs `deliverSignatures`. The signature is the party's own.",
        parameters: [tokenPath, idempotencyKey],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["party", "signature"],
                properties: { party: { $ref: "#/components/schemas/Address" }, signature: { $ref: "#/components/schemas/Hex" } },
              },
            },
          },
        },
        responses: { ...ok({ type: "object", properties: { signed: { type: "boolean" } } }), ...jsonErrors },
      }),
    },
    "/certificates/{token}/apply-transaction": {
      get: op({
        operationId: "applyTransaction",
        tags: ["Certificates"],
        summary: "Unsigned apply calldata",
        description: "Needs `read`. Returns `to`, `data` and `chainId` for `applyCertificate`. Contraflow never submits or sponsors this: the sender pays gas in native USDC, so you need a payer that holds a key and USDC on Arc. A company that signs in with an email has a wallet that signs only inside the Contraflow app; a party can instead open the certificate link there and choose Apply on Arc.",
        parameters: [tokenPath, partyQuery],
        responses: { ...ok({ $ref: "#/components/schemas/ApplyTransaction" }), ...jsonErrors },
      }),
    },
    "/certificates/{token}/transactions": {
      post: op({
        operationId: "reportTransaction",
        tags: ["Certificates"],
        summary: "Report an apply transaction",
        description: "Needs `read`. Reads the ledger and brings the certificate and obligations up to date.",
        parameters: [tokenPath, idempotencyKey],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["party", "txHash"],
                properties: { party: { $ref: "#/components/schemas/Address" }, txHash: { $ref: "#/components/schemas/Bytes32" } },
              },
            },
          },
        },
        responses: { ...ok({ type: "object", properties: { status: { type: "string" } } }), ...jsonErrors },
      }),
    },
    "/certificates/{token}/export": {
      get: op({
        operationId: "exportCertificate",
        tags: ["Certificates"],
        summary: "Export a certificate",
        description: "Needs `read`. The party's `contraflow-netting-certificate/1` view, checkable at /app/verify.",
        parameters: [tokenPath, partyQuery],
        responses: { ...ok({ $ref: "#/components/schemas/CertificateExport" }), ...jsonErrors },
      }),
    },
    "/webhooks/test": {
      post: op({
        operationId: "testWebhook",
        tags: ["Webhooks"],
        summary: "Enqueue a test event",
        description:
          "Queues a `webhook.test` event for this tenant's registered HTTPS endpoint and runs the delivery pipeline after the response. Delivery also runs from `after()` on other authenticated API requests and from the daily Hobby cron at 04:15 UTC — not from a per-minute schedule. 422 `no_webhook` if no endpoint is registered.",
        parameters: [idempotencyKey],
        responses: { ...ok({ $ref: "#/components/schemas/WebhookTest" }, "202"), ...jsonErrors },
      }),
    },
    "/webhooks/endpoint": {
      get: op({
        operationId: "getWebhookEndpoint",
        tags: ["Webhooks"],
        summary: "Read the webhook endpoint",
        description:
          "The tenant's single endpoint (or `null`), whether a rolled secret is still also signing, and the ten latest deliveries. The signing secret is never returned here. No party permission required.",
        responses: { ...ok({ $ref: "#/components/schemas/WebhookEndpoint" }), ...authErrors },
      }),
      post: op({
        operationId: "setWebhookEndpoint",
        tags: ["Webhooks"],
        summary: "Set or replace the webhook endpoint",
        description:
          "Registers one HTTPS URL. Replacing it issues a new signing secret; the old one also signs for 24 hours. The secret is returned once: send an `Idempotency-Key` so a retry returns the same secret, and roll it if a response was lost. The URL must be public HTTPS on the default port; private, loopback, link-local and metadata addresses, and names that resolve to them, are refused when saved and on every delivery. Redirects are not followed. Anyone holding the key can redirect this tenant's future events, so treat it as a secret. No party permission required.",
        parameters: [idempotencyKey],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: { url: { type: "string", format: "uri", maxLength: 2048 } },
              },
            },
          },
        },
        responses: { ...ok({ $ref: "#/components/schemas/WebhookSecret" }), ...jsonErrors },
      }),
      delete: op({
        operationId: "deleteWebhookEndpoint",
        tags: ["Webhooks"],
        summary: "Remove the webhook endpoint",
        description: "Removes the endpoint and drops its queued events. 422 `no_webhook` if none is registered.",
        responses: { "204": { description: "No content" }, ...authErrors, ...errors("422") },
      }),
    },
    "/webhooks/endpoint/secret": {
      post: op({
        operationId: "rollWebhookSecret",
        tags: ["Webhooks"],
        summary: "Roll the signing secret",
        description:
          "Issues a new secret, returned once. The previous secret also signs for 24 hours, so you can switch without dropping events. 422 `no_webhook` if no endpoint is registered.",
        parameters: [idempotencyKey],
        responses: { ...ok({ $ref: "#/components/schemas/WebhookSecret" }), ...jsonErrors },
      }),
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description:
          "`Authorization: Bearer cfk_test_...` (scheme is case-insensitive). A signed-in address creates a test key in the app; it is shown once. Live keys are issued separately.",
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        schema: { type: "string", maxLength: 255 },
        description: "Retrying with the same key returns the first response. Reusing it for a different request is a 409.",
      },
    },
    schemas: {
      Address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      Hex: { type: "string", pattern: "^0x[0-9a-fA-F]*$" },
      Bytes32: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string", enum: [...ERROR_CODES] },
              message: { type: "string" },
            },
          },
        },
      },
      TenantUsage: {
        type: "object",
        required: ["from", "to", "totals", "daily", "keys", "parties", "nextCursor"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          totals: {
            type: "object",
            required: ["requests", "byStatusClass", "byOperation", "topErrorCodes"],
            properties: {
              requests: { type: "integer" },
              byStatusClass: {
                type: "object",
                properties: { "2xx": { type: "integer" }, "4xx": { type: "integer" }, "5xx": { type: "integer" } },
              },
              byOperation: {
                type: "array",
                items: {
                  type: "object",
                  required: ["operation", "requests", "errors"],
                  properties: { operation: { type: "string" }, requests: { type: "integer" }, errors: { type: "integer" } },
                },
              },
              topErrorCodes: {
                type: "array",
                items: { type: "object", required: ["code", "count"], properties: { code: { type: "string" }, count: { type: "integer" } } },
              },
            },
          },
          daily: {
            type: "array",
            items: {
              type: "object",
              required: ["day", "requests", "errors"],
              properties: { day: { type: "string" }, requests: { type: "integer" }, errors: { type: "integer" } },
            },
          },
          keys: {
            type: "array",
            items: {
              type: "object",
              required: ["prefix", "mode", "lastUsedAt", "revoked"],
              properties: {
                prefix: { type: "string" },
                mode: { type: "string", enum: ["test", "live"] },
                lastUsedAt: { type: ["string", "null"], description: "ISO 8601." },
                revoked: { type: "boolean" },
              },
            },
          },
          parties: {
            type: "array",
            items: {
              type: "object",
              required: ["party", "requests", "errors", "lastRequestDay", "permission", "webhooks"],
              properties: {
                party: { $ref: "#/components/schemas/Address" },
                requests: { type: "integer" },
                errors: { type: "integer" },
                lastRequestDay: { type: ["string", "null"] },
                permission: {
                  type: "object",
                  required: ["status", "scopes", "expiresAt"],
                  properties: {
                    status: { type: "string", enum: ["live", "expiring", "expired", "revoked", "none"] },
                    scopes: { type: ["integer", "null"] },
                    expiresAt: { type: ["string", "null"], description: "Unix seconds." },
                  },
                },
                webhooks: {
                  type: "object",
                  required: ["sent", "failed", "suppressed", "lastError"],
                  properties: {
                    sent: { type: "integer" },
                    failed: { type: "integer" },
                    suppressed: { type: "integer" },
                    lastError: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
          nextCursor: { type: ["string", "null"] },
        },
      },
      Tenant: {
        type: "object",
        required: ["tenantId", "name", "status", "mode", "chainId", "webhookConfigured"],
        properties: {
          tenantId: { $ref: "#/components/schemas/Bytes32" },
          name: { type: "string" },
          status: { type: "string", enum: ["active", "suspended"] },
          mode: { type: "string", enum: ["test", "live"] },
          chainId: { type: "integer" },
          webhookConfigured: { type: "boolean" },
        },
      },
      PermissionGrant: {
        type: "object",
        required: ["party", "tenantId", "scopes", "expiresAt", "nonce"],
        properties: {
          party: { $ref: "#/components/schemas/Address" },
          tenantId: { $ref: "#/components/schemas/Bytes32" },
          scopes: { type: "integer", minimum: 1, maximum: 7 },
          expiresAt: { type: "string" },
          nonce: { $ref: "#/components/schemas/Bytes32" },
        },
      },
      StoredPermission: {
        type: "object",
        required: ["permissionId", "party", "scopes", "expiresAt"],
        properties: {
          permissionId: { type: "string" },
          party: { $ref: "#/components/schemas/Address" },
          scopes: { type: "integer" },
          expiresAt: { type: "string" },
          revoked: { type: "boolean" },
        },
      },
      PermissionList: {
        type: "object",
        required: ["permissions"],
        properties: {
          permissions: { type: "array", items: { $ref: "#/components/schemas/StoredPermission" } },
        },
      },
      TypedData: {
        type: "object",
        required: ["domain", "types", "primaryType", "message"],
        properties: {
          domain: {
            type: "object",
            properties: { chainId: { type: "integer" }, name: { type: "string" }, version: { type: "string" }, verifyingContract: { $ref: "#/components/schemas/Address" } },
          },
          types: { type: "object" },
          primaryType: { type: "string" },
          message: { type: "object" },
        },
      },
      TypedDataEnvelope: {
        type: "object",
        required: ["typedData", "digest"],
        properties: {
          typedData: { $ref: "#/components/schemas/TypedData" },
          digest: { $ref: "#/components/schemas/Bytes32" },
        },
      },
      CreateProposalRequest: {
        type: "object",
        required: ["party", "proposerRole", "document", "obligation", "proposerSignature"],
        properties: {
          party: { $ref: "#/components/schemas/Address" },
          proposerRole: { type: "string", enum: ["debtor", "creditor"] },
          document: { $ref: "#/components/schemas/ObligationDocument" },
          obligation: { $ref: "#/components/schemas/SignedObligation" },
          proposerSignature: { $ref: "#/components/schemas/Hex" },
        },
      },
      ObligationDocument: {
        type: "object",
        required: ["format", "description", "debtor", "creditor", "currency", "amount", "maturity", "earlyNetConsent"],
        properties: {
          format: { type: "string", const: "contraflow-obligation/1" },
          description: { type: "string" },
          debtor: { $ref: "#/components/schemas/Address" },
          creditor: { $ref: "#/components/schemas/Address" },
          currency: { type: "string", description: "ISO 4217 code" },
          amount: { type: "string", description: "Major units, exactly as shown to the parties, e.g. \"1250.00\"." },
          maturity: { type: "string", description: "yyyy-mm-dd" },
          earlyNetConsent: { type: "boolean" },
        },
      },
      SignedObligation: {
        type: "object",
        required: ["documentHash", "debtor", "creditor", "currency", "amount", "maturity", "earlyNetConsent", "salt"],
        properties: {
          documentHash: { $ref: "#/components/schemas/Bytes32" },
          debtor: { $ref: "#/components/schemas/Address" },
          creditor: { $ref: "#/components/schemas/Address" },
          currency: { type: "string" },
          amount: { type: "string", description: "ISO 4217 minor-unit integer string. \"10000\" is 100.00 USD." },
          maturity: { type: "string", description: "Unix seconds at midnight UTC of the document date." },
          earlyNetConsent: { type: "boolean" },
          salt: { $ref: "#/components/schemas/Bytes32" },
        },
      },
      AmountMinor: { type: "string", description: "ISO 4217 minor-unit integer string. \"10000\" is 100.00 USD." },
      AmountDisplay: { type: "string", description: "The same amount in major units, plain digits, e.g. \"100.00\"." },
      UnixSeconds: { type: "string", description: "Unix seconds." },
      ProposalListItem: {
        type: "object",
        required: ["token", "waitingOn", "youOwe", "counterparty", "currency", "amountMinor", "amountDisplay", "description", "expiresAt"],
        properties: {
          token: { type: "string" },
          waitingOn: { type: "string", enum: ["you", "them"] },
          youOwe: { type: "boolean" },
          counterparty: { $ref: "#/components/schemas/Address" },
          currency: { type: "string" },
          amountMinor: { $ref: "#/components/schemas/AmountMinor" },
          amountDisplay: { $ref: "#/components/schemas/AmountDisplay" },
          description: { type: "string" },
          expiresAt: { $ref: "#/components/schemas/UnixSeconds" },
        },
      },
      ObligationListItem: {
        type: "object",
        required: [
          "obligationId",
          "youOwe",
          "counterparty",
          "currency",
          "amountMinor",
          "amountDisplay",
          "remainingMinor",
          "remainingDisplay",
          "maturity",
          "description",
          "status",
          "earlyNetConsent",
        ],
        properties: {
          obligationId: { $ref: "#/components/schemas/Bytes32" },
          youOwe: { type: "boolean" },
          counterparty: { $ref: "#/components/schemas/Address" },
          currency: { type: "string" },
          amountMinor: { $ref: "#/components/schemas/AmountMinor" },
          amountDisplay: { $ref: "#/components/schemas/AmountDisplay" },
          remainingMinor: { $ref: "#/components/schemas/AmountMinor" },
          remainingDisplay: { $ref: "#/components/schemas/AmountDisplay" },
          maturity: { $ref: "#/components/schemas/UnixSeconds" },
          description: { type: "string" },
          status: { type: "string", enum: ["active", "closed", "out_of_sync"] },
          earlyNetConsent: { type: "boolean" },
        },
      },
      CertificateListItem: {
        type: "object",
        required: ["token", "status", "currency", "wNetMinor", "wNetDisplay", "deadline", "parties", "signedCount", "youSigned", "appliedTxHash"],
        properties: {
          token: { type: "string" },
          status: { type: "string", enum: ["collecting", "ready", "applied", "expired", "abandoned"] },
          currency: { type: "string" },
          wNetMinor: { $ref: "#/components/schemas/AmountMinor" },
          wNetDisplay: { $ref: "#/components/schemas/AmountDisplay" },
          deadline: { $ref: "#/components/schemas/UnixSeconds" },
          parties: { type: "integer" },
          signedCount: { type: "integer" },
          youSigned: { type: "boolean" },
          appliedTxHash: { type: ["string", "null"] },
        },
      },
      PartyObligationsPage: {
        type: "object",
        required: ["proposals", "obligations", "certificates", "nextCursor"],
        properties: {
          proposals: { type: "array", items: { $ref: "#/components/schemas/ProposalListItem" } },
          obligations: { type: "array", items: { $ref: "#/components/schemas/ObligationListItem" } },
          certificates: { type: "array", items: { $ref: "#/components/schemas/CertificateListItem" } },
          nextCursor: { type: ["string", "null"] },
        },
      },
      LoopSearch: {
        type: "object",
        required: ["outcome"],
        properties: {
          outcome: {
            oneOf: [
              {
                type: "object",
                required: ["found", "token", "currency", "wNetMinor", "wNetDisplay", "parties"],
                properties: {
                  found: { type: "boolean", const: true },
                  token: { type: "string" },
                  currency: { type: "string" },
                  wNetMinor: { $ref: "#/components/schemas/AmountMinor" },
                  wNetDisplay: { $ref: "#/components/schemas/AmountDisplay" },
                  parties: { type: "integer" },
                },
              },
              {
                type: "object",
                required: ["found", "reason", "message"],
                properties: {
                  found: { type: "boolean", const: false },
                  reason: { type: "string", enum: ["no-candidates", "no-loop", "too-many-parties", "search-incomplete", "out-of-sync"] },
                  message: { type: "string" },
                },
              },
            ],
          },
        },
      },
      ProposalResponse: {
        type: "object",
        required: ["proposal"],
        properties: { proposal: { $ref: "#/components/schemas/ProposalRecord" } },
      },
      ProposalRecord: {
        type: "object",
        required: [
          "token",
          "state",
          "viewerRole",
          "proposerRole",
          "domain",
          "obligation",
          "document",
          "proposerSignature",
          "expiresAt",
          "typedData",
          "digest",
        ],
        properties: {
          token: { type: "string" },
          state: { type: "string", enum: ["open", "accepted", "withdrawn", "expired"] },
          viewerRole: { type: "string", enum: ["proposer", "counterparty"] },
          proposerRole: { type: "string", enum: ["debtor", "creditor"] },
          domain: {
            type: "object",
            required: ["chainId", "verifyingContract"],
            properties: {
              chainId: { type: "integer" },
              verifyingContract: { $ref: "#/components/schemas/Address" },
            },
          },
          obligation: { $ref: "#/components/schemas/SignedObligation" },
          document: { $ref: "#/components/schemas/ObligationDocument" },
          proposerSignature: { $ref: "#/components/schemas/Hex" },
          expiresAt: { $ref: "#/components/schemas/UnixSeconds" },
          typedData: { $ref: "#/components/schemas/TypedData" },
          digest: { $ref: "#/components/schemas/Bytes32" },
        },
      },
      CertificateFile: {
        type: "object",
        description: "A `contraflow-netting-certificate/1` file. Integers stay decimal strings, including `wNet` and `domain.chainId`.",
        required: ["format", "domain", "currency", "wNet", "certificate", "signatures", "entries"],
        properties: {
          format: { type: "string", const: "contraflow-netting-certificate/1" },
          domain: {
            type: "object",
            required: ["chainId", "verifyingContract"],
            properties: {
              chainId: { type: "string", description: "Decimal string. A certificate file does not use a JSON number here." },
              verifyingContract: { $ref: "#/components/schemas/Address" },
            },
          },
          currency: { type: "string" },
          wNet: { $ref: "#/components/schemas/AmountMinor" },
          certificate: {
            type: "object",
            required: ["certificateId", "contentHash", "deadline", "entries"],
            properties: {
              certificateId: { $ref: "#/components/schemas/Bytes32" },
              contentHash: { $ref: "#/components/schemas/Bytes32" },
              deadline: { $ref: "#/components/schemas/UnixSeconds" },
              entries: {
                type: "array",
                items: {
                  type: "object",
                  required: ["obligationId", "debtor", "creditor", "priorCommitment", "nextCommitment"],
                  properties: {
                    obligationId: { $ref: "#/components/schemas/Bytes32" },
                    debtor: { $ref: "#/components/schemas/Address" },
                    creditor: { $ref: "#/components/schemas/Address" },
                    priorCommitment: { $ref: "#/components/schemas/Bytes32" },
                    nextCommitment: { $ref: "#/components/schemas/Bytes32" },
                  },
                },
              },
            },
          },
          signatures: { type: "array", items: { type: ["string", "null"] } },
          entries: {
            type: "array",
            items: {
              oneOf: [
                {
                  type: "object",
                  required: ["kind", "entryHash"],
                  properties: { kind: { type: "string", const: "hash" }, entryHash: { $ref: "#/components/schemas/Bytes32" } },
                },
                {
                  type: "object",
                  required: ["kind", "document"],
                  properties: {
                    kind: { type: "string", const: "full" },
                    document: {
                      type: "object",
                      required: ["obligation", "debtorSignature", "creditorSignature", "remainingBefore", "blindingBefore", "remainingAfter", "blindingAfter"],
                      properties: {
                        obligation: { $ref: "#/components/schemas/SignedObligation" },
                        debtorSignature: { $ref: "#/components/schemas/Hex" },
                        creditorSignature: { $ref: "#/components/schemas/Hex" },
                        remainingBefore: { $ref: "#/components/schemas/AmountMinor" },
                        blindingBefore: { $ref: "#/components/schemas/Bytes32" },
                        remainingAfter: { $ref: "#/components/schemas/AmountMinor" },
                        blindingAfter: { $ref: "#/components/schemas/Bytes32" },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
      CertificateRead: {
        type: "object",
        required: ["certificate", "typedData", "digest"],
        properties: {
          certificate: {
            allOf: [
              { $ref: "#/components/schemas/CertificateListItem" },
              {
                type: "object",
                required: ["yourIndex", "view"],
                properties: {
                  yourIndex: { type: "integer" },
                  view: { $ref: "#/components/schemas/CertificateFile" },
                },
              },
            ],
          },
          typedData: { $ref: "#/components/schemas/TypedData" },
          digest: { $ref: "#/components/schemas/Bytes32" },
        },
      },
      CertificateExport: {
        type: "object",
        required: ["fileName", "certificate"],
        properties: {
          fileName: { type: "string" },
          certificate: { $ref: "#/components/schemas/CertificateFile" },
        },
      },
      ApplyTransaction: {
        type: "object",
        required: ["chainId", "to", "value", "data", "note"],
        properties: {
          chainId: { type: "integer" },
          to: { $ref: "#/components/schemas/Address" },
          value: { type: "string" },
          data: { $ref: "#/components/schemas/Hex" },
          note: { type: "string" },
        },
      },
      WebhookSecret: {
        type: "object",
        required: ["secret"],
        properties: {
          url: { type: "string" },
          secret: { type: "string", description: "`whsec_…`, shown once.", example: "whsec_Hq3…" },
          previousSecretValidFor: { type: "string", description: "Present after a roll." },
        },
      },
      WebhookEndpoint: {
        type: "object",
        required: ["endpoint", "recentDeliveries"],
        properties: {
          endpoint: {
            type: ["object", "null"],
            required: ["url", "secretRollingUntil"],
            properties: {
              url: { type: "string" },
              secretRollingUntil: { type: ["string", "null"], description: "Unix seconds while the previous secret also signs." },
            },
          },
          recentDeliveries: {
            type: "array",
            items: {
              type: "object",
              required: ["eventId", "type", "status", "attempts", "createdAt", "statusCode", "error"],
              properties: {
                eventId: { type: "string" },
                type: { type: "string" },
                status: { type: "string", enum: ["pending", "delivered", "failed", "suppressed"] },
                attempts: { type: "integer" },
                createdAt: { type: "string", description: "Unix seconds." },
                statusCode: { type: ["integer", "null"] },
                error: { type: ["string", "null"] },
              },
            },
          },
        },
      },
      WebhookTest: {
        type: "object",
        required: ["eventId", "type"],
        properties: {
          eventId: { type: "string" },
          type: { type: "string", const: "webhook.test" },
        },
      },
      WebhookEvent: {
        type: "object",
        required: ["id", "type", "created", "chainId", "data"],
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: [...WEBHOOK_EVENT_TYPES] },
          created: { type: "integer" },
          chainId: { type: "integer" },
          data: { type: "object" },
        },
      },
    },
    responses: {
      Error: {
        description: "An error. A party you have no permission for, and a row that doesn't exist, both answer 404.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  webhooks: {
    event: {
      post: {
        operationId: "receiveWebhook",
        tags: ["Webhooks"],
        summary: "Netting events",
        description:
          "Sent to your endpoint, which you register on the API keys page of the app (public HTTPS only; redirects are not followed), with `Contraflow-Signature: t=<unix>,v1=<hex>`, an HMAC-SHA256 over `<t>.<raw body>` with your `whsec_` secret. Reject timestamps more than 5 minutes old, de-duplicate by `id`, and return 2xx quickly. Failed deliveries retry with backoff (1, 2, 4… minutes, up to 6 hours) for 3 days, but a retry only runs when the pipeline does: after any authenticated API request and at the daily job, so with no traffic it can wait about a day. `certificate.*` events carry `currency`, `wNetMinor`, `wNetDisplay` and, once applied, `appliedTxHash`. Events only name parties that granted you the read scope. Immediate delivery uses Next.js `after()`; the Hobby cron at 04:15 UTC is the retry backstop, not the primary scheduler.",
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/WebhookEvent" } },
          },
        },
        responses: { "200": { description: "Received" } },
      },
    },
  },
} as const;
