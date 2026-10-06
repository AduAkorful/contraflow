import { docsNavLink } from "../../src/site/docsUrl";
import { GITHUB_REPO } from "../../src/site/github";

export type MarketingLink = { label: string; href: string; external?: boolean };

/// Desktop primary destinations. Demo stays off the marketing bar until live demo runs are proven.
export function marketingPrimaryLinks(docs = docsNavLink()): MarketingLink[] {
  return [
    { label: "How it works", href: "/#how-it-works" },
    { label: "Developers", href: docs.href, external: docs.external },
    { label: "Pricing", href: "/pricing" },
    { label: "About", href: "/about" },
  ];
}

/// Extra items in the mobile menu only. Docs is the Developers destination on desktop.
export function marketingMobileExtraLinks(): MarketingLink[] {
  return [
    { label: "Features", href: "/features" },
    { label: "Verify", href: "/app/verify" },
    { label: "Contact", href: "/contact" },
  ];
}

export function marketingFooterColumns(docs = docsNavLink()): { title: string; links: MarketingLink[] }[] {
  return [
    {
      title: "Product",
      links: [
        { label: "How it works", href: "/#how-it-works" },
        { label: "Features", href: "/features" },
        { label: "Pricing", href: "/pricing" },
      ],
    },
    {
      title: "Developers",
      links: [
        { label: "Docs", href: docs.href, external: docs.external },
        { label: "Integrations & API", href: "/integrations" },
        { label: "Source on GitHub", href: GITHUB_REPO, external: true },
      ],
    },
    {
      title: "Trust",
      links: [
        { label: "Verify a certificate", href: "/app/verify" },
        { label: "Terms of Service", href: "/terms" },
        { label: "Privacy Policy", href: "/privacy" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Contact", href: "/contact" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
      ],
    },
  ];
}
