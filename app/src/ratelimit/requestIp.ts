/// The caller's IP for per-IP limits on public actions. "unknown" when no proxy header is present,
/// which puts every such caller in one shared bucket rather than exempting them.

import { headers } from "next/headers";

export async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
