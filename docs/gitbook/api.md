# API

The Contraflow API lets a platform you already use, such as an ERP, an accounting app or a marketplace, record offchain obligations for its customers, find netting loops and apply netting certificates, over HTTPS. Every endpoint, with request and response examples, is in the [API reference](reference/api.md). The machine-readable contract is the OpenAPI document served by the app at `/api/v1/openapi.json`.

API access is by request: Contraflow issues keys to platforms through the Contact page. Test keys (`cfk_test_…`) run against Arc testnet.

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

## Webhooks

Register one HTTPS endpoint with `POST /webhooks/endpoint`, or on the **API keys** page of the app, where the signing secret is shown once. You can replace the endpoint, roll the secret (the old one also signs for 24 hours), remove it, send a test event and see the latest deliveries there. The URL must be a public HTTPS address on the default port: private, loopback and link-local addresses are refused, and redirects are not followed. The API can also read the endpoint and recent deliveries (`GET /webhooks/endpoint`), roll the secret (`POST /webhooks/endpoint/secret`) and remove it (`DELETE /webhooks/endpoint`). See the [API reference](reference/api.md).

Contraflow sends signed events to your registered URL:

* `obligation.recorded`
* `certificate.proposed`, `certificate.ready`, `certificate.applied`, `certificate.expired` and `certificate.cancelled`

Each request carries `Contraflow-Signature: t=<unix>,v1=<hex>`, an HMAC-SHA256 of `<t>.<raw body>` with your `whsec_` secret, the same scheme Stripe uses. Verify it against the raw body, reject timestamps more than five minutes old, and de-duplicate by the event's `id`. A failed delivery is retried with backoff (1, 2, 4… minutes, up to 6 hours) for three days, but retries only run when the pipeline does: after any authenticated API request and at the daily job, so with no traffic a retry can wait about a day. Call the API, for example `GET /webhooks/endpoint`, on your own timer to retry sooner. Events only name parties that gave you the read scope.
