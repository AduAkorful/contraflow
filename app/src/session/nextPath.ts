/// Where to send someone after sign-in. Only same-site `/app/...` paths qualify, so a crafted link
/// (`/app?next=https://evil.example`, `//evil.example`, `/\evil`) can never become an open redirect.
/// `/app` itself is refused too: it is the sign-in page, so returning there would loop.
export function safeNextPath(raw: string | string[] | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 600) return null;
  if (!raw.startsWith("/app/")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  if (raw.includes("//") || raw.includes("://")) return null;
  return raw;
}

/// Link to the sign-in page that returns here afterwards.
export function signInHref(returnTo: string): string {
  const next = safeNextPath(returnTo);
  return next ? `/app?next=${encodeURIComponent(next)}` : "/app";
}
