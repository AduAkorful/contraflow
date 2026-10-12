# Data model

Contraflow keeps data in three places: Arc (the source of truth for everything onchain), Supabase Postgres, and
Upstash Redis. The Postgres schema is created by the SQL migrations in `app/src/db/migrations/`, which can safely
be run more than once. Addresses and hex values are stored lowercase.

## Invoices (cache of onchain data)

These tables mirror what's on Arc so pages load fast. They're reconciled against the explorer and never trusted
over the chain. Anything missing is rebuilt from the Registry's event log.

```mermaid
erDiagram
  invoices {
    text invoice_ref PK "the invoice id"
    text debtor
    text creditor
    numeric amount_usdc
    bigint maturity
    boolean early_net_consent
    text status
    text register_tx_hash
    text settle_tx_hash
    numeric w_net_usdc
    numeric remaining_usdc
  }
  settlements {
    text settle_tx_hash PK
    bigint block_number
    numeric w_net_usdc
    integer cycle_length
    numeric gas_paid_wei
  }
  invoice_documents {
    text invoice_ref PK
    text description
    text debtor
    text creditor
    text amount_usdc
    text maturity
    text created_by
  }
  invoice_links {
    text token PK "short-link token"
    jsonb payload
    text debtor
    text creditor
    timestamptz expires_at "30 days"
  }
  addresses {
    text address PK
    text starter_grant_tx_hash
    timestamptz starter_granted_at
  }
  settlements ||--o{ invoices : "settle_tx_hash"
  invoices ||--o| invoice_documents : "invoice_ref"
```

| Table | Who can read it |
|---|---|
| `invoices`, `settlements` | Public through the app, since the data is public onchain |
| `invoice_documents` | The invoice's two parties only, through session-checked actions. It's never joined into a public query. |
| `invoice_links` | The invoice's two parties only. The token is a handle, not access control. Expired rows are treated as not found. |
| `addresses` | Server only: which addresses have had the one-time starter gas grant |

## Offchain obligations

```mermaid
erDiagram
  netting_proposals {
    text token PK "short-link token"
    text obligation_id UK
    text chain_id
    text ledger
    text proposer
    text counterparty
    text proposer_role "debtor or creditor"
    jsonb obligation
    jsonb document
    text proposer_signature
    text status "open, accepted, withdrawn"
    text closed_by "who withdrew or declined it"
    text close_note "a decline's reason, up to 200 characters"
    timestamptz expires_at "30 days"
    text created_by_tenant "API tenant, if any"
  }
  netting_obligations {
    text obligation_id PK
    text chain_id
    text ledger
    text document_hash
    text debtor
    text creditor
    text currency
    text amount "minor units"
    text maturity
    boolean early_net_consent
    text salt
    text debtor_signature
    text creditor_signature
    text description
    text remaining
    text blinding
    text status "active, closed, out_of_sync, disputed"
    text disputed_by "party that raised a dispute"
    timestamptz disputed_at
    text dispute_note "optional, up to 200 characters"
    text dispute_reply "the other party's reply, up to 200 characters"
    timestamptz dispute_replied_at
  }
  netting_certificates {
    text certificate_id PK
    text token UK
    text currency
    text w_net
    text deadline
    text content_hash
    jsonb full_view "server only"
    text status "collecting, ready, applied, expired, abandoned"
    text applied_tx_hash
  }
  netting_certificate_entries {
    text certificate_id PK, FK
    int idx PK
    text obligation_id FK
    text debtor
    text creditor
    boolean locked
  }
  netting_certificate_signatures {
    text certificate_id PK, FK
    int idx PK
    text signer
    text signature
  }
  netting_proposals ||--o| netting_obligations : "becomes"
  netting_certificates ||--|{ netting_certificate_entries : has
  netting_certificates ||--o{ netting_certificate_signatures : has
  netting_obligations ||--o{ netting_certificate_entries : "appears in"
```

- **Party-only.** Every one of these tables is readable only by the parties involved (or a tenant holding a
  party's permission), through service functions that check the caller. None is joined into a public query.
- **`full_view`.** A certificate's `full_view` holds every entry's amounts and blindings. It never leaves the
  server: each party receives only its own view.
- **One open certificate per obligation.** A partial unique index on `netting_certificate_entries (obligation_id)
  WHERE locked` enforces it. Closing a certificate unlocks its entries in the same transaction.
- **The database follows the ledger.** `remaining` and `blinding` advance only after the ledger reports the
  certificate applied and the stored state reproduces the onchain commitment.

## API

```mermaid
erDiagram
  tenants {
    text tenant_id PK "32 random bytes"
    text name
    text status "active, suspended"
    text owner_address "signed-in creator, or null"
  }
  tenant_api_keys {
    text key_hash PK "SHA-256 of the key"
    text tenant_id FK
    text mode "test, live"
    text prefix "for display"
    timestamptz last_used_at "stamped at most once a minute"
    timestamptz revoked_at
  }
  tenant_usage_daily {
    text tenant_id PK, FK
    date day PK "UTC"
    text operation PK "OpenAPI operationId"
    text party PK "acting party, empty if none"
    text status_class PK "2xx, 4xx, 5xx"
    text error_code PK
    int count "counts only; kept 90 days"
  }
  tenant_permissions {
    text permission_id PK
    text tenant_id FK
    text chain_id
    text party
    int scopes "read 1, propose 2, deliverSignatures 4"
    bigint expires_at
    text nonce
    text signature "the party's EIP-712 signature"
    timestamptz revoked_at
  }
  webhook_endpoints {
    text tenant_id PK, FK
    text url
    text secret
    text previous_secret "valid 24 h after a roll or a replace"
    timestamptz previous_expires_at
  }
  webhook_events {
    text event_id PK
    text tenant_id FK
    bigint seq "cursor for GET /events"
    text type
    jsonb payload
    int attempts
    timestamptz next_attempt_at
    text status "pending, delivered, failed, suppressed, no_endpoint"
  }
  webhook_deliveries {
    text event_id PK, FK
    int attempt PK
    int status_code
    text error
  }
  api_idempotency {
    text tenant_id PK, FK
    text idem_key PK
    text request_hash
    int status_code
    jsonb response
  }
  netting_party_rules {
    text party PK
    bool allowlist_enabled
    text_array allowed "approved counterparties, lowercased"
    timestamptz updated_at
  }
  netting_changes {
    bigint change_id PK
    text kind "obligation, certificate"
    text ref_id
    text chain_id
    text status
    timestamptz claimed_at
    timestamptz processed_at
  }
  tenants ||--o{ tenant_api_keys : has
  tenants ||--o{ tenant_permissions : "granted by parties"
  tenants ||--o{ tenant_usage_daily : counts
  tenants ||--o| webhook_endpoints : has
  tenants ||--o{ webhook_events : receives
  webhook_events ||--o{ webhook_deliveries : attempts
  tenants ||--o{ api_idempotency : has
```

`netting_changes` is written by triggers on `netting_obligations` (insert) and `netting_certificates` (insert and
status change). The webhook pipeline turns each change into events for tenants with `read` permission from a party
it touches, then rechecks current permission before every send. Events are recorded for every such tenant,
whether or not it has an endpoint, so `GET /events` can page them by `seq`; they are kept for 30 days.
`webhook_events.status` can be `pending`, `delivered`, `failed`, `suppressed` or `no_endpoint`. A suppressed event
is terminal and was withheld after access changed. A `no_endpoint` event was recorded for a tenant that had no
endpoint at the time; it is readable through `GET /events` and is never delivered later. None
of the API tables is readable outside the server. `tenants.owner_address` (migration 013) is the signed-in
address that created a self-serve tenant, unique when set. Operator-created tenants leave it null. A key's secret
is never stored.

## Upstash Redis

Nothing in Redis is permanent. Losing it would cancel sign-ins in progress and reset caches and rate-limit windows, but lose no data. Sessions are signed cookies, not Redis entries. The one exception is sign-out: a hash of each signed-out cookie is kept until the cookie would have expired (24 hours at most), and losing those entries would let a copied, signed-out cookie work again until then.

| Key | Holds | Lifetime |
|---|---|---|
| Sign-in nonces | Issued, unused SIWE nonces | 5 minutes; deleted on first use |
| Rate-limit counters | Per-IP, per-party and per-tenant request counts | The limit's window |
| Inspector cache | Onchain facts about an address or loop | 10 minutes |
| Protocol stats | Running totals and the block cursor | Until rebuilt |
| Chain index | The Registry's registered and netted events, the largest nonce per pair, and a block cursor (rebuilt from the deployment block if lost) | Until rebuilt |
| Locks | Stats refresh, webhook pipeline | Seconds; released when done |

## Onchain

| Contract | Stores |
|---|---|
| Registry | Every invoice's parties, maturity, early-netting consent, status, remaining amount and nonce; the last nonce per pair |
| Settler | Only its registry address |
| Netting ledger | One blinded commitment per obligation key; whether each certificate ID has been applied |

Amounts of offchain obligations, their currencies and all descriptions are never onchain.
