/// Per-IP rate limit for the inspector's public, unauthenticated actions. Each call can fan out to
/// a dozen or more explorer requests, so without a limit these actions would be an easy way to get
/// this deployment rate-limited by Blockscout.

import { checkRateLimit } from "../ratelimit/limiter";
import { requestIp } from "../ratelimit/requestIp";

export const SIGNALS_UNAVAILABLE = "Couldn't load onchain signals right now.";

const MAX_REQUESTS = 20;
const WINDOW_SECONDS = 60;

export type GuardResult = { allowed: true } | { allowed: false; error: string };

export async function guardInspectorRequest(scope: "address" | "cycle"): Promise<GuardResult> {
  const ip = await requestIp();
  try {
    const { allowed } = await checkRateLimit(`inspector:${scope}:${ip}`, MAX_REQUESTS, WINDOW_SECONDS);
    return allowed ? { allowed: true } : { allowed: false, error: "Too many lookups. Try again in a minute." };
  } catch {
    // The limiter is the only thing standing between this public action and the explorer's own
    // rate limit, so an unreachable limiter fails closed.
    return { allowed: false, error: SIGNALS_UNAVAILABLE };
  }
}
