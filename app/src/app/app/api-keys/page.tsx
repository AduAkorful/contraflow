import { SignInGate } from "@/components/wallet/SignInGate";
import type { OwnTenantView } from "@/src/api/ownKeys";
import { postgresOwnKeyStore } from "@/src/db/ownKeys";
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
  if (session) {
    try {
      tenant = await postgresOwnKeyStore.list(session.address.toLowerCase());
    } catch {
      unavailable = true;
    }
  }

  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
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
        <ApiKeysPanel tenant={tenant} />
      )}
    </section>
  );
}
