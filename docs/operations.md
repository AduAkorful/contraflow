# Operations

Running, deploying and maintaining Contraflow. Repo-only: GitBook doesn't publish files at the top of `docs/`. The
public reference is under `docs/gitbook/reference/`.

## Requirements

| Tool | Version |
|---|---|
| Node.js | 22 |
| pnpm | 10 (`packageManager` pins `pnpm@10.33.2`) |
| Foundry | `forge` with solc `0.8.36` (pinned in `contracts/foundry.toml`, `evm_version = "cancun"`, optimizer 200 runs) |
| `psql` | Optional, for running SQL by hand |

## Quick start

```bash
pnpm install
cp app/.env.example app/.env.local        # then fill it in (see below), or: vercel env pull app/.env.local
node --env-file=app/.env.local app/scripts/migrate.mjs
pnpm --filter @contraflow/solver build
cd app && pnpm dev                        # http://localhost:3000
```

Checks:

```bash
cd contracts && forge test                       # contracts
cd app && pnpm test && pnpm typecheck && pnpm build   # app (some tests call live Circle services)
pnpm --filter @contraflow/solver test            # solver
```

## Environment variables

App variables, from `app/.env.example`. `NEXT_PUBLIC_*` values reach the browser; everything else is server-only.

| Variable | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | Everything that reads or writes the database | Supabase's shared pooler in transaction mode (port 6543, user `postgres.<project-ref>`), from the dashboard's Connect dialog. Set it explicitly in Vercel (Production and Preview); the Marketplace integration's `POSTGRES_*` names aren't read. Never the project's anon or service_role key. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Sign-in nonces, rate limits, caches, locks | Paste without surrounding quotes: a quoted value silently broke sign-in once |
| `SESSION_SECRET` | Signing session cookies | 32 random bytes, hex. Rotating it logs everyone out. |
| `NEXT_PUBLIC_APP_DOMAIN` | Sign-in domain binding | The exact host serving the app (`localhost:3000` locally). Required. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Sign-in (wallet and email) | Public by design. The 25-character placeholder in `providers.tsx` keeps pages rendering without it. |
| `NEXT_PUBLIC_DOCS_URL` | Docs link in the site nav, footer and app sidebar, and the `/docs` redirect | Optional https override. Unset, Docs opens `https://aduakorful.gitbook.io/contraflow-docs`. Read at build time, so redeploy after changing it. |
| `ARC_TESTNET_RPC` | Chain reads and writes | Defaults to the public RPC if unset |
| `CONTRAFLOW_OPERATOR_PK` | `/app/demo`, starter gas grants, identifying operator activity in stats | A funded testnet key. Never a mainnet key. Without it, stats report unavailable rather than count the demo as usage. |
| `STARTER_GAS_GRANT_AMOUNT_USDC` | Starter grant size | Defaults to `0.05` |
| `STARTER_GAS_GRANT_DAILY_CAP_USDC` | Most paid out in grants per UTC day | Defaults to `1` |
| `NEXT_PUBLIC_ARC_NETWORK` | Chain this deployment serves | `mainnet` selects 5042; anything else is testnet. Build-time |
| `ARC_RPC` | RPC for reads and sending | Keyed provider first, Arc's public endpoints after it |
| `ARC_LOGS_RPC` | RPC for log scans | Must allow 9,999-block ranges |
| `DEMO_OPERATOR_PK` | Funded testnet key for `/app/demo` | Required on a mainnet deployment |
| `CRON_SECRET` | `/api/cron/webhooks` | Vercel Cron sends it as a bearer token |

Contract deploys use `contracts/.env`: `ARC_TESTNET_RPC`, `DEPLOYER_PK`, `OWNER_ADDRESS`.

## Database migrations

Migrations live in `app/src/db/migrations/` and are written to be re-runnable (`IF NOT EXISTS`, drop-then-create
for triggers).

```bash
node --env-file=app/.env.local app/scripts/migrate.mjs          # all, in order
node --env-file=app/.env.local app/scripts/migrate.mjs 006      # only files starting 006
```

The runner splits statements on `;` but keeps `$$ … $$` function bodies whole and applies them one at a time
through the same adapter the app uses. If a run can't reach the database (`ETIMEDOUT`), re-run it.

Migration `011_supabase_lockdown.sql` turns on row-level security for every table and removes all access for
Supabase's `anon` and `authenticated` roles, so the project's public Data API can never read these tables. Every
new table needs `ENABLE ROW LEVEL SECURITY` in its own migration; `test/db.integration.test.ts` fails if one
is missing. Also switch the Data API off in the project's settings. The app doesn't use it.

The database connection verifies Supabase's TLS certificate against the root pinned in `src/db/postgres.ts`
("Supabase Root 2021 CA", valid to 2031-04-26, SHA-256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`).
Compare that fingerprint with the certificate in the dashboard's Database settings before replacing it.

To run the database integration tests, point `TEST_DATABASE_URL` at a scratch database with migrations
001–013 applied (never the app's own) and run `pnpm vitest run test/db.integration.test.ts`.

| # | Adds |
|---|---|
| 001 | `invoices`, `settlements`, `addresses` |
| 002 | `invoice_documents` |
| 003 | `netting_proposals`, `netting_obligations` |
| 004 | Certificates, entries (with the lock index), signatures; the `out_of_sync` status |
| 005 | API tenants, keys, permissions, webhook tables, idempotency; `netting_proposals.created_by_tenant` |
| 006 | `netting_changes` and its triggers |
| 007 | Nullable settlement fee for unknown DCW fees |
| 008 | Durable starter-grant operation reservations |
| 009 | Owner-token leases for recoverable API idempotency operations |
| 010 | Terminal `suppressed` webhook-event status after permission loss |
| 011 | Row-level security on every table; no privileges for `anon` or `authenticated` |
| 012 | `invoice_links` for short invoice share links |
| 013 | `tenants.owner_address` for self-serve test API keys |

## Operator scripts

### API tenants (`app/scripts/tenant.mjs`)

```bash
node --env-file=app/.env.local app/scripts/tenant.mjs create "Acme ERP"
node --env-file=app/.env.local app/scripts/tenant.mjs issue-key <tenantId> test
node --env-file=app/.env.local app/scripts/tenant.mjs set-webhook <tenantId> https://acme.example/contraflow
node --env-file=app/.env.local app/scripts/tenant.mjs roll-webhook-secret <tenantId>
node --env-file=app/.env.local app/scripts/tenant.mjs revoke-key <keyPrefix>
node --env-file=app/.env.local app/scripts/tenant.mjs usage <tenantId> [days]
node --env-file=app/.env.local app/scripts/tenant.mjs list
```

- **Self-serve test keys.** A signed-in address creates its own tenant and test keys at `/app/api-keys` (migration 013).
  The secret is shown once. This script remains the path for live keys, webhook endpoints and tenants with no owner.
- **Shown once.** Keys and webhook secrets are printed once and never stored in the clear (webhook secrets are
  stored, since signing needs them). Send them to the tenant over a secure channel.
- **Key limit.** A tenant can hold at most two active keys.
- **Usage.** `usage` prints a tenant's recorded calls (operation, status class, error code, count) for the last 1–90 days and
  each key's last use. The same counts reach the tenant at `GET /api/v1/usage`, and its owner at `/app/api-keys`. Counts are
  kept 90 days; the daily cron deletes older rows.
- **Live keys.** `live` keys only work once mainnet addresses are in `app/src/contracts/addresses.ts`.
- **Webhook URLs.** They must be `https` (plain `http` is allowed for `localhost` only).

### Contract ABIs

`pnpm --filter @contraflow/app sync-abi` copies ABIs from `contracts/out` into `app/src/contracts/abi`. Run it
after any contract change.

## Contract deploy

The deploy and smoke scripts run on exactly two chains, Arc testnet (`5042002`) and Arc mainnet (`5042`), and
refuse any other. Environment: `DEPLOYER_PK`, `OWNER_ADDRESS` (the upgrade admin; never the zero address), and the
`--rpc-url`. Broadcasting on mainnet also needs `CONFIRM_MAINNET=true`, so a mainnet transaction is never one
mistyped flag away. Never put a key in a file that is committed.

| Variable | Effect |
|---|---|
| `DEPLOY_OUT_DIR` | Where the record goes. Default `deployments`; `rehearsal` is git-ignored. A rehearsal sets `DEPLOY_OUT_DIR=rehearsal` so it can never replace a recorded deployment |
| `DEPLOY_OVERWRITE=true` | Allows replacing an existing record. Without it an existing record makes the script revert |
| `CONFIRM_MAINNET=true` | Required to broadcast on chain `5042` (a simulation needs none) |

A record (`<dir>/testnet.json`, `<dir>/mainnet.json`, and `<network>-netting-ledger.json`) is written only
while broadcasting. A dry run leaves nothing on disk.

1. **Dry run.** `forge script script/Deploy.s.sol:Deploy --rpc-url $RPC`, and
   `script/DeployNettingLedger.s.sol:DeployNettingLedger` for the ledger. Check the logged addresses, owner and
   estimated gas. On 2026-10-11 both simulated cleanly against Arc mainnet (about 4.17M gas for Registry plus
   Settler and 2.53M for the ledger, at the 40 gwei the node suggested; Arc's minimum fee is 20 gwei).
2. **Broadcast.** Re-run with `--broadcast`. Each proxy is deployed and initialised in one transaction
   (`ERC1967Proxy(impl, initCalldata)`), so there's no window where an uninitialised proxy could be claimed.
3. **Verify** on Sourcify (`forge verify-contract <address> <Contract> --verifier sourcify --chain <id>`) and on
   Arc's Blockscout. Blockscout compiles up to solc 0.8.36, which is why the source is pinned there; anything
   built with a newer solc fails with "Unable to verify", which looks transient but isn't. The testnet contracts
   deployed on 2026-09-22 were built with 0.8.37, so only Sourcify verifies them.
4. **Record.**
   - Print the `addresses.ts` entry from Foundry's own broadcast output, never by hand:
     `node app/scripts/addresses-from-broadcast.mjs --chain <id>` (it checks the creation order and the receipts and
     prints the deployment block). Paste it into `app/src/contracts/addresses.ts` and register it in
     `ADDRESSES_BY_CHAIN_ID`.
   - Add the explorer API URL for the chain to `app/src/blockscout/explorer.ts`, once it answers an automated request
     live (the invoice flows, stats and receipts don't need it; only the cycle inspector does).
5. **Confirm onchain.** Run `cast code`, `cast call <proxy> "owner()(address)"`, and the ERC-1967
   implementation slot for each proxy. The helper prints the commands.

Rehearse on testnet (`5042002`) before mainnet (`5042`), with `DEPLOY_OUT_DIR=rehearsal` and without recording
the rehearsal's addresses anywhere in the repository.

## Data cutover (wipe before mainnet)

`app/scripts/reset-data.mjs` empties every row of every table in `public` (schema, row-level security and the
lockdown stay) and the cache keys that belong to the chain being left. It is irreversible. Take a Supabase backup
first if there is any doubt; restoring it is the only undo. Freeze testnet use before running it.

```bash
# dry run (the default): prints the target, rows per table, the lockdown state and Redis keys; changes nothing
node --env-file=app/.env.local app/scripts/reset-data.mjs
# execute: --confirm must equal the project ref the dry run printed
node --env-file=app/.env.local app/scripts/reset-data.mjs --execute --confirm=<project-ref>
```

- It refuses unless `DATABASE_URL` names a known Supabase project (or a local database) and `--confirm` matches it,
  refuses if the lockdown doesn't hold (RLS on every table, no `anon` or `authenticated` privileges), and checks
  Redis is reachable before deleting anything.
- Tables are discovered from the database. One transaction runs `TRUNCATE ... RESTART IDENTITY CASCADE`; a failure
  rolls everything back. It then reads every table back and re-checks the lockdown.
- Redis is swept by prefix with `SCAN` and `DEL`, never `FLUSHALL` (demo runs and budget, sign-in nonces, rate-limit
  counters, API and webhook locks, stats, inspector and quote caches, loop-search caches, the chain index). The
  signed-out session deny-list (`session:revoked:*`) is kept, because deleting it would let a copied, signed-out
  cookie work again until it expires. Pass `--include-revocations` only together with a new `SESSION_SECRET`.
- It does not turn off the Supabase Data API; do that separately in the dashboard.

Consequences to announce first: every test API key and webhook endpoint stops working, every starter-grant record
goes (so mainnet addresses are eligible again), signed-in users sign in again, and Mode B obligations and
certificates are gone (they cannot be rebuilt from the chain).

## Vercel

| Setting | Value |
|---|---|
| Root directory | `app` (the Next.js package; `next` isn't in the repo root) |
| Build | `pnpm build`. The `prebuild` script builds `packages/solver`, whose `dist/` isn't committed. Don't remove it. |
| Env vars | Everything in the table above, for each environment |
| Cron | `app/vercel.json` schedules `/api/cron/webhooks` daily at 04:15 UTC. The Hobby plan only allows daily crons (a more frequent schedule fails the deploy). Deliveries do not wait on that cron: every authenticated API request and web-app obligation write runs the pipeline in a Next.js `after()` hook. Tenants can also `POST /api/v1/webhooks/test` to enqueue a `webhook.test` event. On Pro you can run the cron every minute. |

`app/src/app/app/layout.tsx` keeps `dynamic = "force-dynamic"`. Without it, the build prerenders the Privy provider and
crashes.

## Monitoring

| What | Where |
|---|---|
| Server errors | Vercel function logs. Look for `API request failed`, `Webhook pipeline failed`, `Protocol stats failed`. |
| Webhook delivery | `webhook_events` (status, attempts, next attempt) and `webhook_deliveries` (each attempt's HTTP status or error) |
| Unprocessed changes | `SELECT count(*) FROM netting_changes WHERE processed_at IS NULL` should stay near zero |
| Protocol activity | The stats block on `/app`, counted from contract events |
| Operator gas balance | `cast balance <operator> --rpc-url $RPC`. Starter grants and the demo draw on it. |

## Runbooks

### Database unreachable (`ETIMEDOUT`, `ECONNREFUSED`, "timeout exceeded when trying to connect")

App code retries a failure to *reach* the database through `withDbRetry`, and never retries an error that
happened mid-statement, because that statement may already have committed. For scripts, re-run them; migrations
and tenant commands are safe to repeat. A `Tenant or user not found` error from the pooler means the host and
user don't belong to the same project: copy both from the Connect dialog. A free-tier project that has paused
after inactivity also answers with a connection error until it's restored from the dashboard.

### Upstash unreachable

- **What stops, deliberately:** sign-in (nonces can't be issued), the inspector, protocol stats and the API. They
  fail closed, because the rate limiter guards the chain RPC and the explorer. Existing sessions stop working too:
  signed-out cookies are checked against Redis, and an unreadable list counts as signed out. Signing out fails
  with a message rather than leave the session valid.
- **What keeps working:** public pages, `/app/verify` and anything that doesn't need a session or the limiter.
- **Checks:** confirm the Upstash values aren't wrapped in quotes.

### Protocol stats show "unavailable"

1. Check `CONTRAFLOW_OPERATOR_PK` is set (without it, stats refuse to mix demo activity into real totals).
2. Check Upstash is reachable.
3. Check the explorer responds.

Stored totals are served with their real "as of" time while a refresh is failing.

### Explorer (Blockscout) lag or errors

Only the cycle inspector reads the explorer now. It says "unavailable" and never gates a transaction. Invoice
registration (next nonce), invoice-loop search, history reconciliation, receipts and stats read Arc directly.

### Chain index behind ("couldn't read this pair's invoice history")

The two-party invoice flow reads the Registry's events through a chain index in Redis (`chainidx:v1:<chain>:<registry>:*`,
rebuildable from the deployment block). It fails closed: while it is behind the head, nonce lookups say to try again
and loop search says "incomplete", never "no loop". It advances whenever someone has the home page open, and on
demand. A cold index on a long-lived chain is about 330 ranges (about 6 minutes at one call a second); warm it by
calling the protected route until it reports `index.caughtUp: true`:

```bash
until curl -s -H "Authorization: Bearer $CRON_SECRET" https://<deployment>/api/cron/stats | grep -Eq '"index":(null|\{[^}]*"caughtUp":true)'; do sleep 1; done
```

### Gateway residual funding failed after the deposit

`fundResidualViaGateway` throws `GatewayFundResidualPartialFailureError` when the deposit landed but a later step
failed. Resume with `resumeFundResidualViaGateway`, which never deposits again. CCTP confirmation takes about ten
minutes on testnet.

### Webhooks failing for a tenant

1. Query `webhook_events` and `webhook_deliveries` for the tenant's recent events. `suppressed` means read access
   was revoked, expired or the tenant was suspended before delivery; restore permission and create a new event if
   the tenant should receive a later state change. Suppressed events are terminal and are not replayed.
2. Fix the endpoint, or re-register it with `set-webhook`.
3. Wait for the next retry. Pending events retry with backoff for three days, then are marked `failed`.
4. To force a pass, call the cron route with the secret, or have the tenant `POST /api/v1/webhooks/test`:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/webhooks
   ```

### A tenant key leaked

1. Run `tenant.mjs revoke-key <prefix>` straight away, then issue a new key.
2. Assess the exposure. A key can't sign anything, and only reaches parties that gave that tenant a permission.
3. Ask those parties to review their permissions, or revoke them through the API.

### An obligation is `out_of_sync`

The stored state disagrees with the ledger: a certificate was applied that the database didn't record. It's
excluded from netting automatically. Compare `stateOf(obligationKey)` onchain with
`keccak256(abi.encode(id, remaining, blinding))` from the row, and find the certificate that moved it
(`ObligationAdvanced` events). Correct the row only from that certificate's recorded after-state.

### Starter grants stop

Grants stop when the daily cap (1 USDC) is reached or the operator balance runs low. Check the operator balance and
top it up. The cap resets on a rolling window.
