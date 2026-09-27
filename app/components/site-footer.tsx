import Link from "next/link";

const MAIN_PAGE_LINKS = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Integrations", href: "/integrations" },
  { label: "Verify a certificate", href: "/app/verify" },
];

const INNER_PAGE_LINKS = [
  { label: "Contact", href: "/contact" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto max-w-6xl px-6 py-20">
      <div className="grid gap-12 border-t border-white/10 pt-16 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <h3 className="font-serif-display text-3xl leading-tight">Netting, not credit.</h3>
          <p className="mt-4 max-w-md text-sm text-muted">
            Contraflow finds loops of debt between counterparties and nets them out: USDC invoices in
            one transaction on Arc, and obligations in any currency with one certificate everyone
            signs.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-muted">Product</p>
          <ul className="mt-4 space-y-2 text-sm">
            {MAIN_PAGE_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-foreground/80 hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-muted">Company</p>
          <ul className="mt-4 space-y-2 text-sm">
            {INNER_PAGE_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-foreground/80 hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-xs text-muted md:flex-row">
        <p>© 2026 Contraflow. All rights reserved.</p>
        <div className="flex gap-6">
          <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
        </div>
      </div>
    </footer>
  );
}
