import Link from "next/link";
import { docsUrl } from "../src/site/docsUrl";

const DOCS_URL = docsUrl();

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
      { label: "Integrations", href: "/integrations" },
      { label: "Verify a certificate", href: "/app/verify" },
      ...(DOCS_URL ? [{ label: "Docs", href: DOCS_URL, external: true }] : []),
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
] as const;

type FooterLink = { label: string; href: string; external?: boolean };

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto max-w-6xl px-6 py-16">
      <div className="grid gap-12 border-t border-border-subtle pt-14 sm:grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="sm:col-span-3 lg:col-span-1">
          <h3 className="font-serif-display text-3xl leading-tight">Netting, not credit.</h3>
          <p className="mt-4 max-w-md text-sm text-muted">
            Contraflow finds loops of debt between counterparties and nets them out: USDC invoices in
            one transaction on Arc, and obligations in any currency with one certificate everyone
            signs.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-sm font-medium text-foreground">{column.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {(column.links as readonly FooterLink[]).map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a href={link.href} target="_blank" rel="noreferrer" className="text-muted hover:text-foreground">
                      {link.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <Link href={link.href} className="text-muted hover:text-foreground">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <p className="mt-14 border-t border-border-subtle pt-8 text-xs text-faint">© 2026 Contraflow. All rights reserved.</p>
    </footer>
  );
}
