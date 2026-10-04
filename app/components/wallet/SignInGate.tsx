import Link from "next/link";
import { signInHref } from "../../src/session/nextPath";

/// The one card every signed-out `/app/...` page shows. It links to sign-in with the page to come
/// back to, so signing in lands you where you were headed instead of on the sign-in page.
export function SignInGate({ returnTo, message }: { returnTo: string; message: string }) {
  return (
    <div className="mt-8 rounded-card border border-border-subtle bg-surface-1 p-6 text-center">
      <p className="text-sm text-muted">{message}</p>
      <Link href={signInHref(returnTo)} className="mt-3 inline-block text-sm text-gold hover:underline">
        Sign in to continue →
      </Link>
    </div>
  );
}
