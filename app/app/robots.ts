import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  const host = domain && !/^(localhost|127\.0\.0\.1)(:|$)/.test(domain) ? `https://${domain}` : undefined;
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/app/demo", "/app/verify"],
      disallow: ["/app/", "/api/"],
    },
    sitemap: host ? `${host}/sitemap.xml` : undefined,
  };
}
