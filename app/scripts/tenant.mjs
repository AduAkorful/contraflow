// Operator tool for named tenants, live keys and webhook endpoints.
// A signed-in address creates its own test keys at /app/api-keys. Use this for live keys
// and for tenants that have no owner_address.
// Usage (from app/):
//   node --env-file=.env.local scripts/tenant.mjs create "<name>"
//   node --env-file=.env.local scripts/tenant.mjs issue-key <tenantId> test|live
//   node --env-file=.env.local scripts/tenant.mjs revoke-key <keyPrefix>
//   node --env-file=.env.local scripts/tenant.mjs set-webhook <tenantId> <https-url>
//   node --env-file=.env.local scripts/tenant.mjs roll-webhook-secret <tenantId>
//   node --env-file=.env.local scripts/tenant.mjs usage <tenantId> [days]
//   node --env-file=.env.local scripts/tenant.mjs list
// A new key is printed once and never stored; only its SHA-256 hash is. The key format must stay
// identical to `src/api/keys.ts` (`cfk_<mode>_` + 32 random bytes, base64url).
import { createDb } from "../src/db/postgres.ts";
import { createHash, randomBytes } from "node:crypto";

const MAX_ACTIVE_KEYS = 2;
const DISPLAY_PREFIX_CHARS = 13;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL — run with --env-file=.env.local");
const sql = createDb(url);
const [command, ...args] = process.argv.slice(2);

async function create(name) {
  if (!name) throw new Error("Usage: create <name>");
  const tenantId = `0x${randomBytes(32).toString("hex")}`;
  await sql`INSERT INTO tenants (tenant_id, name) VALUES (${tenantId}, ${name})`;
  console.log(`Created tenant "${name}": ${tenantId}`);
}

async function issueKey(tenantId, mode) {
  if (!tenantId || !["test", "live"].includes(mode)) throw new Error("Usage: issue-key <tenantId> test|live");
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM tenant_api_keys
                                WHERE tenant_id = ${tenantId.toLowerCase()} AND revoked_at IS NULL`;
  if (count >= MAX_ACTIVE_KEYS) throw new Error(`Tenant already has ${MAX_ACTIVE_KEYS} active keys; revoke one first.`);
  const key = `cfk_${mode}_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(key, "utf8").digest("hex");
  await sql`INSERT INTO tenant_api_keys (key_hash, tenant_id, mode, prefix)
            VALUES (${hash}, ${tenantId.toLowerCase()}, ${mode}, ${key.slice(0, DISPLAY_PREFIX_CHARS)})`;
  console.log("New API key (shown once, store it now):");
  console.log(key);
}

async function revokeKey(prefix) {
  if (!prefix) throw new Error("Usage: revoke-key <keyPrefix>");
  const rows = await sql`UPDATE tenant_api_keys SET revoked_at = now()
                         WHERE prefix = ${prefix} AND revoked_at IS NULL RETURNING tenant_id`;
  console.log(rows.length === 1 ? `Revoked ${prefix}.` : `No single active key with prefix ${prefix}; nothing revoked.`);
}

function newWebhookSecret() {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

async function setWebhook(tenantId, url) {
  if (!tenantId || !url) throw new Error("Usage: set-webhook <tenantId> <https-url>");
  const parsed = new URL(url);
  // Plain http is only for a local receiver during testing.
  const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) throw new Error("Webhook URLs must be https.");
  const secret = newWebhookSecret();
  await sql`INSERT INTO webhook_endpoints (tenant_id, url, secret) VALUES (${tenantId.toLowerCase()}, ${url}, ${secret})
            ON CONFLICT (tenant_id) DO UPDATE SET url = EXCLUDED.url, secret = EXCLUDED.secret,
              previous_secret = NULL, previous_expires_at = NULL`;
  console.log(`Webhook set to ${url}. Signing secret (shown once, store it now):`);
  console.log(secret);
}

async function rollWebhookSecret(tenantId) {
  if (!tenantId) throw new Error("Usage: roll-webhook-secret <tenantId>");
  const secret = newWebhookSecret();
  // The old secret keeps signing too for 24 hours, so the tenant can switch without dropping events.
  const rows = await sql`UPDATE webhook_endpoints SET previous_secret = secret, previous_expires_at = now() + interval '24 hours',
                           secret = ${secret}
                         WHERE tenant_id = ${tenantId.toLowerCase()} RETURNING url`;
  if (rows.length !== 1) throw new Error("No webhook endpoint for that tenant.");
  console.log("New signing secret (shown once; the old one also signs for 24 hours):");
  console.log(secret);
}

async function list() {
  const rows = await sql`SELECT t.tenant_id, t.name, t.status, k.prefix, k.mode, k.revoked_at
                         FROM tenants t LEFT JOIN tenant_api_keys k ON k.tenant_id = t.tenant_id
                         ORDER BY t.created_at, k.created_at`;
  for (const r of rows) {
    console.log(`${r.name} ${r.tenant_id} ${r.status} ${r.prefix ?? "-"} ${r.mode ?? ""} ${r.revoked_at ? "revoked" : ""}`);
  }
}

async function usage(tenantId, days = "30") {
  if (!tenantId) throw new Error("Usage: usage <tenantId> [days]");
  const n = Math.min(90, Math.max(1, Number.parseInt(days, 10) || 30));
  const rows = await sql`SELECT operation, status_class, error_code, sum(count)::int AS n
                         FROM tenant_usage_daily
                         WHERE tenant_id = ${tenantId.toLowerCase()} AND day > (now() AT TIME ZONE 'utc')::date - ${n}::int
                         GROUP BY operation, status_class, error_code ORDER BY operation, status_class, error_code`;
  if (rows.length === 0) console.log(`No recorded calls in the last ${n} days.`);
  for (const r of rows) console.log(`${r.operation} ${r.status_class} ${r.error_code || "-"} ${r.n}`);
  const keys = await sql`SELECT prefix, last_used_at, revoked_at FROM tenant_api_keys WHERE tenant_id = ${tenantId.toLowerCase()}`;
  for (const k of keys) console.log(`key ${k.prefix} last used ${k.last_used_at ?? "never"}${k.revoked_at ? " (revoked)" : ""}`);
}

const commands = {
  usage: () => usage(args[0], args[1]),
  create: () => create(args[0]),
  "issue-key": () => issueKey(args[0], args[1]),
  "revoke-key": () => revokeKey(args[0]),
  "set-webhook": () => setWebhook(args[0], args[1]),
  "roll-webhook-secret": () => rollWebhookSecret(args[0]),
  list,
};
if (!commands[command]) {
  console.error("Commands: create, issue-key, revoke-key, set-webhook, roll-webhook-secret, usage, list");
  process.exit(1);
}
try {
  await commands[command]();
} finally {
  await sql.end();
}
