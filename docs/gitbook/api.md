# API

The Contraflow API lets a platform you already use, such as an ERP, an accounting app or a marketplace, record offchain obligations for its customers, find netting loops and apply netting certificates, over HTTPS. Every endpoint, with request and response examples, is in the [API reference](reference/api.md). The machine-readable contract is the OpenAPI document served by the app at `/api/v1/openapi.json`.

Test keys (`cfk_test_…`) run against Arc testnet and are self-serve: sign in and create one at `/app/api-keys`. Live keys (`cfk_live_…`) are issued by request through the Contact page once Contraflow is live on Arc mainnet.

## What other companies see

Companies in one loop see the loop's addresses and, in full, only their own two obligations. The other companies' obligations are hashes to them, so a company never learns another company's amounts or terms. A platform acting for several companies gets each company's own view.

## How signing works

Contraflow never signs for anyone. Every obligation and every netting certificate carries the signature of the party it binds, exactly as in the app. The API returns the exact EIP-712 payload to sign, and the platform gets it signed however it manages its customers' keys: the customer's own wallet, the platform's own custody, or a company smart account (ERC-1271 signatures are accepted). The API only ever accepts signatures.

## Acting for a party

A platform can only act for a party that has signed a permission for it. A permission names the platform, lists what it may do and expires within a year:

* **read** (1): see the party's obligations and certificates;
* **propose** (2): propose obligations and netting loops that include the party;
* **deliverSignatures** (4): submit signatures the party made.

None of them lets the platform sign. A party without a permission, and an obligation that doesn't exist, both answer `404 Not found`, so the API never confirms what a platform can't see.

## The flow

1. Get each party's signed permission: `GET /permissions/typed-data`, then `POST /permissions`.
2. Propose an obligation with the proposer's signature: `POST /obligations/proposals`. The response includes the payload the counterparty signs.
3. Accept it with the counterparty's signature: `POST /obligations/proposals/{token}/accept`.
4. Find a loop: `POST /parties/{address}/loops`.
5. Collect each party's signature on the certificate: `GET /certificates/{token}`, then `POST /certificates/{token}/signatures`.
6. Apply it: `GET /certificates/{token}/apply-transaction` returns the transaction. Anyone can submit it, and the sender pays the Arc gas, so you need a payer that holds a key and some USDC on Arc: a funded wallet your platform controls, or a party who opens the certificate link in the app and chooses **Apply on Arc**. A company that signed in with an email has a wallet that only signs inside the app. Report the hash with `POST /certificates/{token}/transactions`.
7. Keep each party's copy: `GET /certificates/{token}/export`. It can be checked on **Verify a certificate**.

Send an `Idempotency-Key` header with every `POST`. A retry with the same key returns the first response, and reusing a key for a different request answers `409`.

## Catching up, bulk imports and limits

* **Missed webhooks:** `GET /events?after=<cursor>` returns your events oldest first, so you can catch up after an outage without waiting for retries. Events are recorded with or without an endpoint and kept for 30 days.
* **Bulk import:** `POST /obligations/proposals/batch` takes up to 25 signed proposals and answers per item. Obligation writes are limited to 120 per party per 10 minutes through the API; a 429 carries `RateLimit-*` and `Retry-After`.
* **Loops:** a loop has 2 to 5 parties and is searched from the party asking (see [How loops are chosen](reference/offchain-netting.md#how-loops-are-chosen)). A 6-party cycle answers `loop-too-long`; a longer one can read as `no-loop`, because the search only looks a couple of hops out. Cycles over 5 parties are never netted whole.
* **Searching:** search when something changes (an `obligation.recorded` or `certificate.applied` event), not on a timer. Each party has 10 searches per 10 minutes. If two searches collide you may get `409 conflict`: search again.
* **Stuck certificates:** a certificate waiting for signatures holds its obligations until it is signed, applied, declined (`DELETE /certificates/{token}?party=`) or expires after 7 days. A search that finds nothing for that reason lists them in `pendingCertificates`.
* **Links:** proposals and certificates include `appUrl`, the link to open in the Contraflow app.

## Webhooks

Register one HTTPS endpoint with `POST /webhooks/endpoint`, or on the **API keys** page of the app, where the signing secret is shown once. You can replace the endpoint, roll the secret (the old one also signs for 24 hours), remove it, send a test event and see the latest deliveries there. The URL must be a public HTTPS address on the default port: private, loopback and link-local addresses are refused, and redirects are not followed. The API can also read the endpoint and recent deliveries (`GET /webhooks/endpoint`), roll the secret (`POST /webhooks/endpoint/secret`) and remove it (`DELETE /webhooks/endpoint`). See the [API reference](reference/api.md).

Contraflow sends signed events to your registered URL:

* `obligation.recorded`
* `certificate.proposed`, `certificate.ready`, `certificate.applied`, `certificate.expired` and `certificate.cancelled`

Each request carries `Contraflow-Signature: t=<unix>,v1=<hex>`, an HMAC-SHA256 of `<t>.<raw body>` with your `whsec_` secret, the same scheme Stripe uses. Verify it against the raw body, reject timestamps more than five minutes old, and de-duplicate by the event's `id`. A failed delivery becomes due again after 1, 2, 4… minutes (up to 6 hours) for three days, and goes out the next time the delivery pipeline runs after it is due: after any authenticated API request, after obligation activity in the web app, and in a daily job. For a company that is calling the API this is usually within minutes; if nothing calls Contraflow it can wait up to about a day. Call the API on your own timer, for example `GET /events`, to be sure, and catch up with `GET /events?after=<cursor>`. Events only name parties that gave you the read scope.

## Using an AI agent

Give your coding agent the brief at `/contraflow-api.md` (and `/llms.txt` as its index). See [Use the API with an AI agent](api-agents.md).
