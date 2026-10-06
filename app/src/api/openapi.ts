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
  scope: "Offchain obligations only. There is no invoice or settlement API.",
  endpoints: [
    { method: "GET", path: "/", description: "This index" },
    { method: "GET", path: "/openapi.json", description: "OpenAPI 3.1 document" },
    { method: "GET", path: "/tenant", description: "This tenant" },
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
  ],
};

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Contraflow API",
    version: "1.0.0",
    description:
      "Record offchain obligations for your customers, find netting loops, collect each party's certificate signature and apply certificates on Arc. Contraflow never signs for anyone: every obligation and certificate carries the party's own signature, and you act for a party only under a permission it signed. Test keys (`cfk_test_`) use Arc testnet. Amounts on signed obligations are integer strings in the currency's ISO 4217 minor units; the human-readable document uses major units (for example `\"1250.00\"` USD). In EIP-712 typed-data responses, `domain.chainId` is a JSON number and `digest` is the payload's hash; other integers stay decimal strings. Authorization is case-insensitive `Bearer`. There is no invoice or settlement API.",
  },
  servers: [
    { url: "https://contraflow.vercel.app/api/v1", description: "Hosted app" },
    { url: "/api/v1", description: "Same origin" },
  ],
  tags: [
    { name: "Tenant" },
    { name: "Permissions" },
    { name: "Obligations" },
    { name: "Certificates" },
    { name: "Webhooks" },
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
        responses: { ...ok({ type: "object", properties: { proposal: { type: "object" } } }, "201"), ...jsonErrors },
      }),
    },
    "/obligations/proposals/{token}": {
      get: op({
        operationId: "getObligationProposal",
        tags: ["Obligations"],
        summary: "Read a proposal",
        description: "Needs the party's `read` scope. Non-parties get 404.",
        parameters: [tokenPath, partyQuery],
        responses: { ...ok({ type: "object", properties: { proposal: { type: "object" } } }), ...jsonErrors },
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
        description: "Needs `read`. Stable order: proposals, then obligations, then certificates, each by id. Pass `cursor` from `nextCursor` for the next page. Default limit 50, max 100.",
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
        responses: { ...ok({ type: "object" }), ...jsonErrors },
      }),
    },
    "/certificates/{token}": {
      get: op({
        operationId: "getCertificate",
        tags: ["Certificates"],
        summary: "Read a certificate",
        description: "Needs `read`. Returns the party's view plus typed data to sign.",
        parameters: [tokenPath, partyQuery],
        responses: { ...ok({ type: "object" }), ...jsonErrors },
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
        description: "Needs `read`. Returns `to`, `data` and `chainId` for `applyCertificate`. Contraflow never submits this; the sender pays gas.",
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
        responses: { ...ok({ type: "object", properties: { fileName: { type: "string" }, certificate: { type: "object" } } }), ...jsonErrors },
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
      Tenant: {
        type: "object",
        required: ["tenantId", "name", "status", "mode", "chainId", "webhookConfigured"],
        properties: {
          tenantId: { $ref: "#/components/schemas/Bytes32" },
          name: { type: "string" },
          status: { type: "string", enum: ["active", "suspended"] },
          mode: { type: "string", enum: ["test", "live"] },
          chainId: { type: "string" },
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
      TypedDataEnvelope: {
        type: "object",
        required: ["typedData", "digest"],
        properties: {
          typedData: {
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
      PartyObligationsPage: {
        type: "object",
        required: ["proposals", "obligations", "certificates", "nextCursor"],
        properties: {
          proposals: { type: "array", items: { type: "object" } },
          obligations: { type: "array", items: { type: "object" } },
          certificates: { type: "array", items: { type: "object" } },
          nextCursor: { type: ["string", "null"] },
        },
      },
      ApplyTransaction: {
        type: "object",
        required: ["chainId", "to", "value", "data", "note"],
        properties: {
          chainId: { type: "string" },
          to: { $ref: "#/components/schemas/Address" },
          value: { type: "string" },
          data: { $ref: "#/components/schemas/Hex" },
          note: { type: "string" },
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
          chainId: { type: "string" },
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
          "Sent to your registered URL with `Contraflow-Signature: t=<unix>,v1=<hex>`, an HMAC-SHA256 over `<t>.<raw body>` with your `whsec_` secret. Reject timestamps more than 5 minutes old, de-duplicate by `id`, and return 2xx quickly. Failed deliveries retry with backoff for 3 days. Events only name parties that granted you the read scope. Immediate delivery uses Next.js `after()`; the Hobby cron at 04:15 UTC is the retry backstop, not the primary scheduler.",
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
