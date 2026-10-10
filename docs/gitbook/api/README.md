# API

The Contraflow API lets a platform you already use, such as an ERP, an accounting app or a marketplace, record
offchain obligations for its customers, find netting loops and apply netting certificates, over HTTPS. Every endpoint,
with request and response examples, is in the [API reference](../reference/api.md). The machine-readable contract
is the OpenAPI document served by the app at `/api/v1/openapi.json`.

API access is by request: Contraflow issues keys to platforms through the Contact page. Test keys
(`cfk_test_…`) run against Arc testnet.

## How signing works

Contraflow never signs for anyone. Every obligation and every netting certificate carries the signature of the
party it binds, exactly as in the app. The API returns the exact EIP-712 payload to sign, and the platform gets
it signed however it manages its customers' keys: the customer's own wallet, the platform's own custody, or a
company smart account (ERC-1271 signatures are accepted). The API only ever accepts signatures.

## Acting for a party

A platform can only act for a party that has signed a permission for it. A permission names the platform, lists
what it may do and expires within a year:

- **read** (1): see the party's obligations and certificates;
- **propose** (2): propose obligations and netting loops that include the party;
- **deliverSignatures** (4): submit signatures the party made.

None of them lets the platform sign. A party without a permission, and an obligation that doesn't exist, both
answer `404 Not found`, so the API never confirms what a platform can't see.

## The flow

1. Get each party's signed permission: `GET /permissions/typed-data`, then `POST /permissions`.
2. Propose an obligation with the proposer's signature: `POST /obligations/proposals`. The response includes the
   payload the counterparty signs.
3. Accept it with the counterparty's signature: `POST /obligations/proposals/{token}/accept`.
4. Find a loop: `POST /parties/{address}/loops`.
5. Collect each party's signature on the certificate: `GET /certificates/{token}`, then
   `POST /certificates/{token}/signatures`.
6. Apply it: `GET /certificates/{token}/apply-transaction` returns the transaction. Anyone can submit it, and
   the sender pays the Arc gas. Report the hash with `POST /certificates/{token}/transactions`.
7. Keep each party's copy: `GET /certificates/{token}/export`. It can be checked on **Verify a certificate**.

Send an `Idempotency-Key` header with every `POST`. A retry with the same key returns the first response, and
reusing a key for a different request answers `409`.

## Your books

Contraflow records the netting and does not touch your customers' accounting. When a certificate is applied, each
obligation in the loop is reduced by the netted amount in Contraflow's records and the ledger commits to the new
state. No USDC moves except gas.

Updating the books is the platform's step. Key it on `certificate.applied`, then read the party's obligations
(`GET /parties/{address}/obligations`, where `remainingMinor` is what is still owed) or the certificate
(`wNetMinor` is the amount netted) and post the reduction in the party's ERP or ledger. Contraflow does not post
entries for you.

A certificate is a signed record that works alongside the parties' agreements. It does not by itself discharge a
debt under any legal or accounting standard; that depends on the parties' agreements and their law.

## Webhooks

Contraflow sends signed events to your registered URL:

- `obligation.recorded`
- `certificate.proposed`, `certificate.ready`, `certificate.applied`, `certificate.expired` and
  `certificate.cancelled`

Each request carries `Contraflow-Signature: t=<unix>,v1=<hex>`, an HMAC-SHA256 of `<t>.<raw body>` with your
`whsec_` secret, the same scheme Stripe uses. Verify it against the raw body, reject timestamps more than five
minutes old, and de-duplicate by the event's `id`. Failed deliveries are retried with backoff for three days.
Events only name parties that gave you the read scope.
