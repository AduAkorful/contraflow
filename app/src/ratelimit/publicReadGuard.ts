import { checkRateLimit } from "./limiter";
import { requestIp } from "./requestIp";

/// Bounds public server actions that fan out into explorer pagination and database writes.
/// Limiter errors fail closed because they protect shared provider capacity.
export async function guardPublicRead(scope: "history" | "invoice-freshness"):
  Promise<{ allowed: true } | { allowed: false; error: string }> {
  try {
    const ip = await requestIp();
    const { allowed } = await checkRateLimit(`public-read:${scope}:${ip}`, 10, 60);
    return allowed ? { allowed: true } : { allowed: false, error: "Too many lookups. Try again in a minute." };
  } catch {
    return { allowed: false, error: "This lookup is temporarily unavailable." };
  }
}
