import Link from "next/link";
import { marketingFooterColumns, type MarketingLink } from "./marketing/nav";

const COLUMNS = marketingFooterColumns();

export function SiteFooter() {
  return (
    <footer className="relative z-10 mx-auto max-w-6xl px-6 py-16">
      <div className="grid gap-12 border-t border-border-subtle pt-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(5,minmax(0,1fr))]">
        <div className="sm:col-span-2 lg:col-span-1">
          <h3 className="font-serif-display text-3xl leading-tight">Net loops of debt.</h3>
          <p className="mt-4 max-w-md text-sm text-muted">No cash moves except gas.</p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-sm font-medium text-foreground">{column.title}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {column.links.map((link: MarketingLink) => (
                <li key={`${link.label}:${link.href}`}>
                  {link.external ? (
                    <a href={link.href} target="_blank" rel="noreferrer" className="tap-inline text-muted hover:text-foreground">
                      {link.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <Link href={link.href} className="tap-inline text-muted hover:text-foreground">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <p className="mt-14 border-t border-border-subtle pt-8 text-sm text-faint">© 2026 Contraflow. All rights reserved.</p>
    </footer>
  );
}
