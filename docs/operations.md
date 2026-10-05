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
| `NEXT_PUBLIC_DOCS_URL` | Docs link in the site nav, footer and app sidebar | Optional. An https URL, set once the GitBook site is published; empty means no Docs link. Read at build time, so redeploy after changing it. |
| `ARC_TESTNET_RPC` | Chain reads and writes | Defaults to the public RPC if unset |
| `CONTRAFLOW_OPERATOR_PK` | `/app/demo`, starter gas grants, identifying operator activity in stats | A funded testnet key. Never a mainnet key. Without it, stats report unavailable rather than count the demo as usage. |
| `STARTER_GAS_GRANT_AMOUNT_USDC` | Starter grant size | Defaults to `0.05` |
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
001–011 applied (never the app's own) and run `pnpm vitest run test/db.integration.test.ts`.

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

## Operator scripts

### API tenants (`app/scripts/tenant.mjs`)

```bash
node --env-file=app/.env.local app/scripts/tenant.mjs create "Acme ERP"
node --env-file=app/.env.local app/scripts/tenant.mjs issue-key <tenantId> test
node --env-file=app/.env.local app/scripts/tenant.mjs set-webhook <tenantId> https://acme.example/contraflow
node --env-file=app/.env.local app/scripts/tenant.mjs roll-webhook-secret <tenantId>
node --env-file=app/.env.local app/scripts/tenant.mjs revoke-key <keyPrefix>
node --env-file=app/.env.local app/scripts/tenant.mjs list
```

- **Shown once.** Keys and webhook secrets are printed once and never stored in the clear (webhook secrets are
  stored, since signing needs them). Send them to the tenant over a secure channel.
- **Key limit.** A tenant can hold at most two active keys.
- **Live keys.** `live` keys only work once mainnet addresses are in `app/src/contracts/addresses.ts`.
- **Webhook URLs.** They must be `https` (plain `http` is allowed for `localhost` only).

### Contract ABIs

`pnpm --filter @contraflow/app sync-abi` copies ABIs from `contracts/out` into `app/src/contracts/abi`. Run it
after any contract change.

## Contract deploy

1. **Dry run.** `forge script script/Deploy.s.sol --rpc-url $RPC`, and `script/DeployNettingLedger.s.sol` for
   the ledger. Check the logged addresses, owner and gas.
2. **Broadcast.** Re-run with `--broadcast`. Each proxy is deployed and initialised in one transaction
   (`ERC1967Proxy(impl, initCalldata)`), so there's no window where an uninitialised proxy could be claimed.
3. **Verify** on Sourcify (`forge verify-contract <address> <Contract> --verifier sourcify --chain <id>`) and on
   Arc's Blockscout. Blockscout compiles up to solc 0.8.36, which is why the source is pinned there; anything
   built with a newer solc fails with "Unable to verify", which looks transient but isn't. The testnet contracts
   deployed on 2026-09-22 were built with 0.8.37, so only Sourcify verifies them.
4. **Record.**
   - Write the addresses into `contracts/deployments/` and `app/src/contracts/addresses.ts`, copied from the
     broadcast output, never typed by hand.
   - Add the explorer URL for the chain to `blockscoutBaseFor` (`app/src/blockscout/client.ts`), once checked live.
5. **Confirm onchain.** Run `cast code`, `cast call <proxy> "owner()(address)"`, and the ERC-1967
   implementation slot for each proxy.

Rehearse on testnet (`5042002`) before mainnet (`5042`).

## Vercel

| Setting | Value |
|---|---|
| Root directory | `app` (the Next.js package; `next` isn't in the repo root) |
| Build | `pnpm build`. The `prebuild` script builds `packages/solver`, whose `dist/` isn't committed. Don't remove it. |
| Env vars | Everything in the table above, for each environment |
| Cron | `app/vercel.json` schedules `/api/cron/webhooks` daily at 04:15 UTC. The Hobby plan only allows daily crons (a more frequent schedule fails the deploy). On Pro you can run it every minute. |

`app/app/app/layout.tsx` keeps `dynamic = "force-dynamic"`. Without it, the build prerenders the Privy provider and
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

Reconciliation, stats and the inspector read the explorer. They retry on the next request and never overwrite
good data with a failed read. Topic-filtered log search is broken on this explorer, so code pages through full
contract logs and filters locally. Don't switch it back.

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
4. To force a pass, call the cron route with the secret:
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
