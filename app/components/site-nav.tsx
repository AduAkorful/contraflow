"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { marketingMobileExtraLinks, marketingPrimaryLinks, type MarketingLink } from "./marketing/nav";
import { NetworkNotice } from "./network/NetworkNotice";
import { MarketingSignIn } from "./wallet/MarketingSignIn";

function NavLink({ link, className, onClick }: { link: MarketingLink; className: string; onClick?: () => void }) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noreferrer" onClick={onClick} className={className}>
        {link.label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={link.href} onClick={onClick} className={className}>
      {link.label}
    </Link>
  );
}

const PRIMARY_LINKS = marketingPrimaryLinks();
const MOBILE_EXTRA = marketingMobileExtraLinks();

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
    <header className="sticky top-0 z-30 border-b border-border-subtle/60 bg-bg/85 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:text-black"
      >
        Skip to content
      </a>
      <NetworkNotice className="border-b border-border-subtle/60 bg-surface-1 px-6 py-2 text-center text-sm text-muted" />
      <div className="mx-auto max-w-6xl px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-medium tracking-tight">
            <Image src="/logo-mark.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0" priority />
            Contraflow
          </Link>

          <nav className="hidden min-w-0 items-center gap-6 text-sm text-muted lg:flex">
            {PRIMARY_LINKS.map((link) => (
              <NavLink key={`${link.label}:${link.href}`} link={link} className="whitespace-nowrap transition-colors hover:text-foreground" />
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <MarketingSignIn />
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill border border-border-input text-foreground lg:hidden"
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
            {[...PRIMARY_LINKS, ...MOBILE_EXTRA].map((link) => (
              <NavLink
                key={`${link.label}:${link.href}`}
                link={link}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5 hover:text-foreground"
              />
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
