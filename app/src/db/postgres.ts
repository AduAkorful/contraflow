/// The Postgres connection: node-postgres behind one small adapter, so every store in `src/db/` keeps
/// the tagged-template `sql\`...\`` and `sql.transaction([...])` shape it was written against.
/// Nothing in here imports Next, so the migration and tenant scripts load it directly.
///
/// Built for Supabase's shared pooler in transaction mode (port 6543), which is what a serverless
/// function should use: one connection per warm instance, no named prepared statements (node-postgres
/// only prepares when a query is given a `name`, and none are), no session state, no pipelining.

import { Pool, type PoolConfig } from "pg";

export type Row = Record<string, unknown>;

/// A query that has not run yet. It runs, once, when awaited; inside `transaction([...])` it runs on the
/// transaction's own connection instead and is never awaited on its own.
export interface DbQuery extends Promise<Row[]> {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface Db {
  (strings: TemplateStringsArray, ...values: unknown[]): DbQuery;
  query(text: string, values?: readonly unknown[]): DbQuery;
  /// Runs the queries in order inside BEGIN/COMMIT on one connection and returns every result. Any
  /// failure rolls the whole batch back.
  transaction(queries: readonly DbQuery[]): Promise<Row[][]>;
  end(): Promise<void>;
}

/// Supabase's root certificate ("Supabase Root 2021 CA", valid to 2031-04-26), SHA-256
/// 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA.
/// Its pooler and database certificates chain to it and it isn't in Node's trust store, so the
/// connection is verified against it explicitly rather than with `rejectUnauthorized: false`. The same
/// certificate is downloadable from the dashboard's Database settings; compare the fingerprint before
/// replacing this one.
const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`;

const SUPABASE_HOST = /\.supabase\.(com|co)$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

/// Pool settings for a connection string. Pure, so it can be tested without a database.
/// - Supabase hosts: TLS verified against the pinned root.
/// - Local hosts: no TLS, so a Postgres on this machine works for development and tests.
/// - Anything else: TLS verified against Node's own trust store.
/// A `sslmode` in the URL is dropped, because node-postgres would let it override these choices.
export function buildPoolConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(key);

  const base: PoolConfig = {
    connectionString: url.toString(),
    // One connection per warm instance, as Supabase advises for serverless; raise only with evidence
    // that concurrent requests on one instance are queuing for it.
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    query_timeout: 25_000,
    keepAlive: true,
    allowExitOnIdle: true,
  };

  const host = url.hostname;
  if (LOCAL_HOST.test(host)) return base;
  if (SUPABASE_HOST.test(host)) return { ...base, ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } };
  return { ...base, ssl: { rejectUnauthorized: true } };
}

function makeQuery(run: () => Promise<Row[]>, text: string, values: readonly unknown[]): DbQuery {
  let started: Promise<Row[]> | undefined;
  const start = () => (started ??= run());
  return {
    text,
    values,
    then: (onFulfilled, onRejected) => start().then(onFulfilled, onRejected),
    catch: (onRejected) => start().catch(onRejected),
    finally: (onFinally) => start().finally(onFinally),
    [Symbol.toStringTag]: "DbQuery",
  };
}

/// `$1, $2, ...` placeholders for a tagged template.
function toText(strings: TemplateStringsArray): string {
  return strings.reduce((text, part, index) => (index === 0 ? part : `${text}$${index}${part}`), "");
}

export function createDb(connectionString: string): Db {
  const pool = new Pool(buildPoolConfig(connectionString));
  // An idle connection can be dropped by the pooler at any time. The pool discards it and the next
  // query opens a new one, so this is a log line, not a failure.
  pool.on("error", (error: Error & { code?: string }) => {
    console.error(`Idle database connection dropped${error.code ? ` (${error.code})` : ""}`);
  });

  const query = (text: string, values: readonly unknown[] = []): DbQuery =>
    makeQuery(async () => (await pool.query(text, [...values])).rows as Row[], text, values);

  const db = ((strings: TemplateStringsArray, ...values: unknown[]) => query(toText(strings), values)) as Db;
  db.query = query;

  db.transaction = async (queries) => {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      const results: Row[][] = [];
      for (const q of queries) results.push((await client.query(q.text, [...q.values])).rows as Row[]);
      await client.query("COMMIT");
      return results;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is gone, so the server has already rolled the transaction back; the broken
        // client must not return to the pool.
        broken = true;
      }
      throw error;
    } finally {
      client.release(broken);
    }
  };

  db.end = () => pool.end();
  return db;
}
