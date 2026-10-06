import type { QueryClient } from "@tanstack/react-query";
import { postSessionSignedOut } from "../../src/session/channel";

/// Sign out everywhere: revoke the session cookie, drop Privy and wagmi, clear cached queries, tell
/// other tabs, then hard-navigate so no client tree from the previous party survives.

export async function signOutEverywhere(deps: {
  signOut: () => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  disconnect: () => Promise<void>;
  queryClient: QueryClient;
  then?: "app" | "switch";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await deps.signOut();
  if (!result.ok) return result;
  try {
    await deps.logout();
  } catch {
    // Privy may already be logged out.
  }
  try {
    await deps.disconnect();
  } catch {
    // Injected wallets often no-op disconnect.
  }
  deps.queryClient.clear();
  postSessionSignedOut();
  window.location.assign(deps.then === "switch" ? "/app?switch=1" : "/app");
  return { ok: true };
}
