"use client";

import { useRouter } from "next/navigation";
import { ConnectButton } from "./ConnectButton";

/// Sign-in on `/app`. A new sign-in goes on to the page the visitor was headed for (already
/// checked by `safeNextPath` on the server). Without one, `ConnectButton` has already refreshed the
/// page, which then shows the overview.
export function SignInRedirect({ next }: { next: string | null }) {
  const router = useRouter();
  return <ConnectButton onSignedIn={() => next && router.push(next)} />;
}
