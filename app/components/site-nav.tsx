"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const PRIMARY_LINKS = [
  { label: "About", href: "/about" },
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Integrations", href: "/integrations" },
  { label: "Contact", href: "/contact" },
];

export function SiteNav() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header className="relative z-20 mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-medium tracking-tight">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold text-black">
            C
          </span>
          Contraflow
        </Link>

        <nav className="hidden min-w-0 items-center gap-6 text-sm text-muted lg:flex">
          {PRIMARY_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="whitespace-nowrap transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/app"
            className="shrink-0 whitespace-nowrap rounded-pill bg-foreground px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
          >
            Launch App
          </Link>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill border border-white/15 text-foreground lg:hidden"
          >
            <span className="relative block h-3.5 w-4">
              <span
                className={`absolute left-0 top-0 h-px w-4 bg-current transition-transform ${
                  menuOpen ? "translate-y-[7px] rotate-45" : ""
                }`}
              />
              <span
                className={`absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-current transition-opacity ${
                  menuOpen ? "opacity-0" : "opacity-100"
                }`}
              />
              <span
                className={`absolute bottom-0 left-0 h-px w-4 bg-current transition-transform ${
                  menuOpen ? "-translate-y-[7px] -rotate-45" : ""
                }`}
              />
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-nav-menu"
          className="animate-card-entrance mt-4 flex flex-col gap-1 rounded-card border border-white/10 bg-surface p-4 text-sm text-muted lg:hidden"
        >
          {PRIMARY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
