/// Resolves true once `check()` is true, or false after `timeoutMs`. Used to hold a wallet sign-in
/// until Privy is ready: Privy loads only when someone clicks Sign in, and `login()` called before
/// `ready` opens a wallet list with nothing in it.
export async function waitFor(check: () => boolean, timeoutMs: number, intervalMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return true;
}
