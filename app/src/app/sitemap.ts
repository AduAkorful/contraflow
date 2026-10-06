import type { MetadataRoute } from "next";

const PATHS = [
  "/",
  "/about",
  "/features",
  "/pricing",
  "/integrations",
  "/contact",
  "/privacy",
  "/terms",
  "/docs",
  "/app/demo",
  "/app/verify",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  if (!domain || /^(localhost|127\.0\.0\.1)(:|$)/.test(domain)) return [];
  return PATHS.map((path) => ({ url: `https://${domain}${path}` }));
}
