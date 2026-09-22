/// The one function any "my data" server action should call to find out who's signed in — never
/// trust an address passed as a request parameter for that purpose.

import { cookies } from "next/headers";
import { verifySessionToken, type SessionPayload } from "./cookie";

export const SESSION_COOKIE_NAME = "contraflow_session";

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
