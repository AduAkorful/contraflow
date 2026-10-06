import type { Metadata } from "next";

/// Per-route title, description and canonical path. `metadataBase` on the root layout turns the
/// path into an absolute URL when `NEXT_PUBLIC_APP_DOMAIN` is set.
export function pageMeta(path: string, title: string, description: string): Metadata {
  return { title, description, alternates: { canonical: path } };
}
