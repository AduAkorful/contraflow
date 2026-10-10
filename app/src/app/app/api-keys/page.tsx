import { SignInGate } from "@/components/wallet/SignInGate";
import type { OwnTenantView } from "@/src/api/ownKeys";
import { UsagePanel } from "@/components/api/UsagePanel";
import { parseUsageRange, type TenantUsage } from "@/src/api/usage";
import { postgresOwnKeyStore } from "@/src/db/ownKeys";
import { getTenantUsage } from "@/src/db/usage";
import { pageMeta } from "@/src/site/pageMeta";
import { getSession } from "@/src/session/getSession";
import { ApiKeysPanel } from "./ApiKeysPanel";

export const metadata = pageMeta(
  "/app/api-keys",
  "API keys",
  "Create a test API key for your signed-in address. The key is shown once.",
);

export default async function ApiKeysPage() {
  const session = await getSession();
  let tenant: OwnTenantView | null = null;
  let unavailable = false;
  let usage: TenantUsage | null = null;
  if (session) {
    try {
      tenant = await postgresOwnKeyStore.list(session.address.toLowerCase());
    } catch {
      unavailable = true;
    }
    if (tenant) {
      // The tenant comes from the signed-in address, never from a request value.
      const now = new Date();
      const range = parseUsageRange(null, null, now);
      if (range.ok) {
        try {
          usage = await getTenantUsage({
            tenantId: tenant.tenantId,
            from: range.from,
            to: range.to,
            nowSeconds: BigInt(Math.floor(now.getTime() / 1000)),
          });
        } catch {
          usage = null;
        }
      }
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="heading-1">API keys</h1>
      <p className="mt-4 text-sm text-muted">
        A test key lets your product call the API for parties who grant it permission. Contraflow never signs for
        you. The key is shown once, and you can hold two active keys.
      </p>
      {!session ? (
        <SignInGate title="Sign in to create a key" reason="Sign in with your email or wallet. The key belongs to that address." />
      ) : unavailable ? (
        <p className="mt-8 text-sm text-muted">API keys aren&apos;t available right now.</p>
      ) : (
        <>
          <ApiKeysPanel tenant={tenant} />
          {tenant && <UsagePanel usage={usage} />}
        </>
      )}
    </section>
  );
}
