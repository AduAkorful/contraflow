#!/usr/bin/env node
// Empties the app's data for a chain cutover: every row of every table in `public` (schema, row-level
// security and lockdown stay) and the cache keys that belong to the chain being left.
//
// IRREVERSIBLE. A dry run is the default and changes nothing:
//
//   node --env-file=.env.local scripts/reset-data.mjs
//
// To execute, pass both flags. `--confirm` must equal the project the connection string points at,
// which the dry run prints:
//
//   node --env-file=.env.local scripts/reset-data.mjs --execute --confirm=<project-ref>
//
// Other flags:
//   --include-revocations   also delete the signed-out-session deny-list. Only safe together with a
//                           new SESSION_SECRET: otherwise a copied, signed-out cookie works again.
//   --skip-redis            leave Redis alone (database only)
//
// Take a Supabase backup first if there is any doubt: restoring one is the only undo.

import { Redis } from "@upstash/redis";
import { createDb } from "../src/db/postgres.ts";
import {
  checkLockdown,
  countRows,
  discoverTables,
  expectedConfirmation,
  lockdownHolds,
  redisPrefixesToSweep,
  sweepRedis,
  truncateAll,
} from "../src/db/resetData.ts";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const valueOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const execute = flag("execute");
const skipRedis = flag("skip-redis");
const includeRevocations = flag("include-revocations");
const confirm = valueOf("confirm");

function fail(message) {
  console.error(`\nRefusing: ${message}`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set. Run with --env-file=.env.local");
const expected = expectedConfirmation(url);
if (!expected) fail("Can't tell which database DATABASE_URL points at (not a Supabase project or a local database).");

const host = new URL(url).hostname;
console.log(`Target database : ${expected === "local" ? "local" : `Supabase project ${expected}`} (host ${host})`);
console.log(`Mode            : ${execute ? "EXECUTE (deletes data)" : "dry run (changes nothing)"}`);

let redis = null;
if (!skipRedis) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) fail("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set (or pass --skip-redis).");
  redis = new Redis({ url: redisUrl, token: redisToken });
  // Redis first: if it can't be reached, nothing has been deleted yet.
  try {
    await redis.ping();
  } catch (error) {
    fail(`Redis is unreachable (${error instanceof Error ? error.message : error}). Nothing was deleted.`);
  }
}

const db = createDb(url);
try {
  const tables = await discoverTables(db);
  if (tables.length === 0) fail("No tables found in the public schema. Is this the right database?");
  const before = await countRows(db, tables);
  const total = Object.values(before).reduce((a, b) => a + b, 0);

  console.log(`\nTables (${tables.length}), rows before:`);
  for (const table of tables) console.log(`  ${table.padEnd(34)} ${String(before[table]).padStart(8)}`);
  console.log(`  ${"TOTAL".padEnd(34)} ${String(total).padStart(8)}`);

  const lockdown = await checkLockdown(db);
  console.log(`\nLockdown (before): RLS off on ${lockdown.rlsOff.length} table(s); ${lockdown.grants.length} Data API privilege(s).`);
  for (const t of lockdown.rlsOff) console.log(`  RLS OFF: ${t}`);
  for (const g of lockdown.grants) console.log(`  GRANT:   ${g}`);

  const prefixes = redisPrefixesToSweep(includeRevocations);
  if (redis) {
    const planned = await sweepRedis(redis, prefixes, false);
    console.log(`\nRedis keys to remove:`);
    for (const r of planned) console.log(`  ${r.prefix.padEnd(24)} ${String(r.found).padStart(8)}`);
    if (!includeRevocations) console.log(`  (session:revoked:* is kept; see --include-revocations)`);
  }

  if (!execute) {
    console.log(`\nDry run only. To execute: --execute --confirm=${expected}`);
    process.exit(0);
  }

  if (confirm !== expected) fail(`--confirm must be "${expected}" (the target shown above). Nothing was deleted.`);
  if (!lockdownHolds(lockdown)) fail("The lockdown does not hold on this database (see above). Fix that first: nothing was deleted.");

  console.log(`\nTruncating ${tables.length} tables in one transaction...`);
  const after = await truncateAll(db, tables);
  const left = Object.entries(after).filter(([, n]) => n !== 0);
  if (left.length > 0) fail(`Rows remain after the truncate: ${JSON.stringify(left)}`);
  const lockdownAfter = await checkLockdown(db);
  console.log(`Database: every table is empty. Lockdown after: ${lockdownHolds(lockdownAfter) ? "holds" : "DOES NOT HOLD (investigate)"}.`);

  if (redis) {
    const swept = await sweepRedis(redis, prefixes, true);
    console.log(`\nRedis removed:`);
    for (const r of swept) console.log(`  ${r.prefix.padEnd(24)} ${String(r.deleted).padStart(8)} of ${r.found}`);
    // A second pass finds anything written while sweeping (a live deployment may still be running).
    const remaining = (await sweepRedis(redis, prefixes, false)).reduce((n, r) => n + r.found, 0);
    console.log(remaining === 0 ? "Redis: nothing left under those prefixes." : `Redis: ${remaining} key(s) written during the sweep; run again once traffic has stopped.`);
  }
  console.log("\nDone. Turn the Supabase Data API off separately if it is still on.");
} finally {
  await db.end();
}
