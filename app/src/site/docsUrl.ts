/// Where the published documentation lives, or null until it is set. `NEXT_PUBLIC_DOCS_URL` is read
/// at build time, and only an https URL is accepted, so a typo or a `javascript:` value can never
/// become a nav link. With no URL the in-app `/docs` page is used instead of hiding Docs.

export function docsUrl(raw: string | undefined = process.env.NEXT_PUBLIC_DOCS_URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function docsNavLink(raw: string | undefined = process.env.NEXT_PUBLIC_DOCS_URL): { href: string; external: boolean } {
  const published = docsUrl(raw);
  return published ? { href: published, external: true } : { href: "/docs", external: false };
}
