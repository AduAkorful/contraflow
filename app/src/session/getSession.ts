/// The one function any "my data" server action should call to find out who's signed in — never
/// trust an address passed as a request parameter for that purpose.

import { cache } from "react";
import { cookies } from "next/headers";
import { verifySessionToken, type SessionPayload } from "./cookie";
import { isSessionRevoked } from "./revocation";

export const SESSION_COOKIE_NAME = "contraflow_session";

/// A valid, unexpired, not-signed-out session, or null. If the revocation list can't be read the
/// answer is null (signed out): an unreadable list must never let a revoked cookie through. Cached per
/// request, so a page and its layout share one lookup.
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  try {
    if (await isSessionRevoked(token)) return null;
  } catch {
    return null;
  }
  return payload;
});
