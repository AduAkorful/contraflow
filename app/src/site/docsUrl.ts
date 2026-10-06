/// The published documentation. Nav, footer and the app sidebar open this site. `/docs` on this
/// app redirects there. `NEXT_PUBLIC_DOCS_URL` can replace it at build time; only an https URL is
/// accepted, so a typo or a `javascript:` value never becomes a link.

export const PUBLISHED_DOCS_URL = "https://aduakorful.gitbook.io/contraflow-docs";

export function docsUrl(raw: string | undefined = process.env.NEXT_PUBLIC_DOCS_URL || PUBLISHED_DOCS_URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function docsNavLink(raw: string | undefined = process.env.NEXT_PUBLIC_DOCS_URL || PUBLISHED_DOCS_URL): { href: string; external: boolean } {
  const published = docsUrl(raw);
  return { href: published ?? PUBLISHED_DOCS_URL, external: true };
}
