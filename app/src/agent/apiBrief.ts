/// The text an integrator can hand to an AI agent: `/contraflow-api.md` (the brief) and
/// `/llms.txt` (the index). The narrative lives here once; the endpoint index, error codes and
/// webhook event types come from the same constants the API serves, so they can't drift.

import { ERROR_CODES, OPENAPI } from "../api/openapi";
import { WEBHOOK_EVENT_TYPES } from "../api/webhooks";

export const DOCS_URL = "https://aduakorful.gitbook.io/contraflow-docs";

type OperationSpec = { operationId?: string; summary?: string };

export function apiBaseUrl(): string {
  return OPENAPI.servers[0]?.url ?? "/api/v1";
}

function origin(): string {
  const base = apiBaseUrl();
  return base.startsWith("http") ? new URL(base).origin : "";
}

function endpointIndex(): string {
  const paths = OPENAPI.paths as Record<string, Record<string, OperationSpec>>;
  const rows: string[] = [];
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, spec] of Object.entries(methods)) {
      rows.push(`| \`${method.toUpperCase()} ${path}\` | \`${spec.operationId}\` | ${spec.summary ?? ""} |`);
    }
  }
  return ["| Endpoint | operationId | What it does |", "| --- | --- | --- |", ...rows].join("\n");
}

export function apiBriefMarkdown(): string {
  const base = apiBaseUrl();
  return `# Contraflow API brief for AI agents

Contraflow finds loops of debt between counterparties and nets them out, so money that would only go round in a circle never has to move. This API records **offchain obligations** for your customers, finds netting loops, collects each party's signature on a netting certificate, and applies it on Arc. Read this first, then use the OpenAPI document for exact request and response bodies: ${base}/openapi.json

- Base URL: \`${base}\`
- Full docs: ${DOCS_URL} (agent index: ${DOCS_URL}/llms.txt)
- A runnable end-to-end example (three companies, one loop, applied on testnet): ${origin()}/contraflow-quickstart.mjs
- Scope: offchain obligations only. There is no invoice or settlement API.
- Test keys (\`cfk_test_\`) run on Arc testnet (chain 5042002). Live keys (\`cfk_live_\`) answer \`403 live_unavailable\` until Arc mainnet is live. The chain always comes from the key, never from a request.

## Rules that must not be broken

1. **Contraflow never signs for anyone.** Every obligation, permission and certificate carries the signature of the party it binds. If you do not have that party's signature, stop and ask the user to obtain it. Never generate, guess or reuse a signature or a private key for a customer.
2. **Never ask for, print, log or commit secrets**: API keys (\`cfk_…\`), webhook secrets (\`whsec_…\`), private keys. Read them from environment variables or a secret store. Both key types are shown once when created.
3. **You act for one party at a time**, and only under that party's live, signed permission with the scope you need. No permission, or a row that does not exist, both answer \`404 not_found\` by design. Do not treat 404 as proof something is missing.
4. **Send an \`Idempotency-Key\` on every POST**, and on a retry reuse the same key. Never mint a new key to retry a request that returned 5xx or \`409 idempotency_in_progress\`.
5. **Disputes keep an obligation out of netting.** If a customer says an obligation is wrong, call \`POST /obligations/{obligationId}/dispute\` (scope \`propose\`) instead of letting a loop net it; only the party that raised it can withdraw it with \`DELETE\`. Contraflow checks agreement, not that the work was done, and never decides who is right.
6. **A certificate is a signed record. It does not by itself discharge a debt** under any legal or accounting standard. Do not describe it that way to users.
7. Use the exact typed data the API returns. Do not rebuild it.

## Authentication and conventions

- \`Authorization: Bearer cfk_test_…\` (scheme is case-insensitive). A bad or revoked key is \`401 unauthorized\`.
- Create a test key at \`${origin()}/app/api-keys\` after signing in. Two active keys at a time. Live keys are issued by request.
- JSON in, JSON out. Optional \`X-Request-Id\` is echoed back.
- List and summary amounts are \`amountMinor\` (integer string in minor units) and \`amountDisplay\` (major units). Timestamps on those responses are unix-second strings. \`chainId\` is a JSON number.
- Rate limits: 600 requests a minute per tenant (\`RateLimit-*\` headers, \`Retry-After\` on 429), and per party per 10 minutes: 120 obligation writes through the API (propose, accept, withdraw; each batch item counts), 120 obligation reads, 10 loop searches, 30 certificate writes, 120 certificate reads. A 429 carries \`RateLimit-*\` and \`Retry-After\`. For a bulk import use \`POST /obligations/proposals/batch\` (up to 25 per call) and resume after \`Retry-After\`.
- An obligation amount must be above zero and at most 10^15 in major units.
- Errors always look like \`{ "error": { "code": "…", "message": "…" } }\`.

## Permissions (scopes)

| Scope | Bit | Lets you |
| --- | --- | --- |
| \`read\` | 1 | See the party's proposals, obligations and certificates; get the apply transaction; export |
| \`propose\` | 2 | Propose obligations as the party, withdraw them, search for loops |
| \`deliverSignatures\` | 4 | Submit signatures the party made: accepting a proposal, signing a certificate |

A party grants a permission by signing typed data you fetch with \`GET /permissions/typed-data\`, then you store it with \`POST /permissions\` (\`{ permission, signature }\`). Permissions expire within a year and the party can revoke them.

## The flow

1. Get each party's signed permission: \`GET /permissions/typed-data\`, the party signs, \`POST /permissions\`.
2. Propose an obligation with the proposer's signature: \`POST /obligations/proposals\`. The response includes \`typedData\` for the counterparty.
3. The counterparty signs; accept with \`POST /obligations/proposals/{token}/accept\`. The obligation is recorded and \`obligation.recorded\` fires.
4. Find a loop: \`POST /parties/{address}/loops\`. If one exists you get a certificate \`token\` (\`outcome.found\`). Loops have 2 to 5 parties; a cycle that only exists with more parties answers \`loop-too-long\`, not \`no-loop\`. Reasons for none: \`no-candidates\`, \`no-loop\`, \`loop-too-long\`, \`blocked-by-rules\` (a party in the loop only nets with approved counterparties; see \`POST /parties/{address}/rules\`), \`too-many-parties\`, \`search-incomplete\`, \`out-of-sync\`.
5. Collect each party's signature on the certificate: \`GET /certificates/{token}?party=\` for its typed data, then \`POST /certificates/{token}/signatures\`.
6. Apply it: \`GET /certificates/{token}/apply-transaction?party=\` returns \`to\`, \`data\`, \`chainId\`. Send that transaction from a wallet that holds USDC for gas (see below), then report the hash with \`POST /certificates/{token}/transactions\`.
7. Keep each party's copy: \`GET /certificates/{token}/export\`.

## Signing correctly

- Sign with the party's own key or custody, using EIP-712 \`signTypedData\` over the \`typedData\` the API returned (\`domain\`, \`types\`, \`primaryType\`, \`message\`). ERC-1271 smart-account signatures are accepted.
- With viem, pass \`amount\` and \`maturity\` (and other large integers in typed-data messages) as \`bigint\`. A string hashes to a different digest and the signature will be rejected as invalid.
- Never alter fields in \`message\` before signing.

## Who pays gas for an apply

Contraflow never sends or sponsors the apply transaction. The sender pays gas in native USDC on Arc. A company that signed in with an email only has a wallet that signs inside the Contraflow app, so a server cannot send from it. Use a funded wallet your platform controls, or have a party open the certificate link (\`/app/c/{token}\`) and choose **Apply on Arc**, or use any other funded wallet. The \`apply-transaction\` response includes a \`submit\` block with an estimated gas cost and the app link. The API reads the result from the ledger either way.

## Updating the customer's books

Contraflow does not post to anyone's accounting system. \`obligation.recorded\` carries the obligation's amount, currency, maturity and \`proposalToken\`. Key your books on the \`certificate.applied\` webhook. It carries \`currency\`, \`wNetMinor\`, \`wNetDisplay\` (the amount netted) and \`appliedTxHash\`. Read \`GET /parties/{address}/obligations\` (\`remainingMinor\`) for what is still owed.

## Webhooks

- Register one HTTPS endpoint: \`POST /webhooks/endpoint\` with \`{ "url": "https://…" }\`, or on the API keys page. The \`whsec_\` signing secret is returned once. \`GET /webhooks/endpoint\` shows the endpoint and recent deliveries (never the secret). \`POST /webhooks/endpoint/secret\` rolls it (the old one also signs for 24 hours). Send an \`Idempotency-Key\`.
- The URL must be public HTTPS on the default port. Private, loopback, link-local and metadata addresses are refused. Redirects are not followed.
- Each request carries \`Contraflow-Signature: t=<unix>,v1=<hex>\`, an HMAC-SHA256 of \`<t>.<raw body>\` with your secret (the same scheme as Stripe). Verify against the **raw** body, reject timestamps more than five minutes old, and de-duplicate by the event \`id\`. Return 2xx quickly.
- Retries become due after 1, 2, 4… minutes (up to 6 hours) for three days, but they only run when the pipeline does: after any authenticated API request and at a daily job. A due retry runs the next time the pipeline does: after any authenticated API request, after obligation activity in the web app, and at a daily job. That is usually within minutes for an active company and up to about a day if nothing calls Contraflow. Call the API (for example \`GET /webhooks/endpoint\`) on a timer to be sure, or catch up with \`GET /events?after=<cursor>\`, which lists your events oldest first for 30 days whether or not a webhook endpoint is registered. De-duplicate by event \`id\`.
- Event types: ${WEBHOOK_EVENT_TYPES.map((t) => `\`${t}\``).join(", ")}. Events only name parties that granted you \`read\`.

## Error codes

${ERROR_CODES.map((c) => `\`${c}\``).join(", ")}.

- \`409 not_ready\`: not every party has signed yet (or the certificate expired or was cancelled). \`409 already_applied\`: the certificate was already applied. \`409 duplicate_proposal\`: that obligation was already proposed; \`error.details\` has the stored proposal's token and \`appUrl\`. \`409 duplicate_nonce\`: the party already used that permission nonce.
- \`422 rejected\` carries the reason in \`message\` (for example an invalid signature).
- \`500 internal_error\` on a POST with an \`Idempotency-Key\`: keep the key and retry with the same one.

## Endpoint index

${endpointIndex()}

## Before you go live

- Run the whole loop on a test key first (the quick-start script does exactly this): permissions, two obligations, a loop, signatures, apply, webhook.
- Store keys and secrets in a secret manager. Rotate with two active keys and a rolled webhook secret.
- Verify webhook signatures and de-duplicate by event id.
- Decide which wallet pays apply gas and keep it funded.
`;
}

export function llmsTxt(): string {
  const site = origin();
  const brief = site ? `${site}/contraflow-api.md` : "/contraflow-api.md";
  return `# Contraflow

> Multilateral netting on Arc. Contraflow finds loops of debt between counterparties and cancels them out, so money that would only go round in a circle never has to move. The API records offchain obligations, finds loops, collects signatures on a netting certificate and applies it. Contraflow never signs for anyone.

## API

- [API brief for agents](${brief}): scope, hard rules, the flow in order, signing, gas, webhooks, errors, endpoint index. Read this first.
- [OpenAPI 3.1 document](${apiBaseUrl()}/openapi.json): exact request and response bodies.
- [Quick-start script](${site ? `${site}/contraflow-quickstart.mjs` : "/contraflow-quickstart.mjs"}): a runnable three-company loop on testnet, key to applied certificate.
- [API reference](${DOCS_URL}/reference/api.md): the full reference, with examples.

## Docs

- [Documentation index for agents](${DOCS_URL}/llms.txt)
- [Full documentation as one file](${DOCS_URL}/llms-full.txt)
`;
}
