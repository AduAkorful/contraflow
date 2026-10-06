/// Pages whose body already has the primary Sign in control. The header button is hidden there so
/// it isn't a no-op (on `/app`) or a second yellow button next to the body one.

export function isSignInPrimaryPage(pathname: string): boolean {
  if (pathname === "/app") return true;
  if (pathname === "/app/attest" || pathname.startsWith("/app/attest/")) return true;
  if (pathname === "/app/obligations" || pathname.startsWith("/app/obligations/")) return true;
  if (pathname === "/app/balance") return true;
  if (pathname.startsWith("/app/o/")) return true;
  if (pathname.startsWith("/app/c/")) return true;
  return false;
}
