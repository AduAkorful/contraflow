"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isSignInPrimaryPage } from "../../src/session/primarySignInPath";
import { useSignIn } from "../wallet/useSignIn";
import { AddressMenu } from "./AddressMenu";
import { NetworkChip } from "./NetworkChip";
import { SidebarNav } from "./SidebarNav";
import type { NavItem } from "./nav";

/// Sticky bar: brand and menu button on small screens (and always when signed out), network chip and
/// address menu on the right. The menu button opens the same list the sidebar shows.
export function TopBar({ address, items }: { address: string | null; items: NavItem[] }) {
  const pathname = usePathname();
  const { start, phase } = useSignIn();
  const [menuOpen, setMenuOpen] = useState(false);
  const hideHeaderSignIn = isSignInPrimaryPage(pathname);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg/90 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="app-mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="inline-flex size-9 items-center justify-center rounded-md border border-border-input text-foreground lg:hidden"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {menuOpen ? <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /> : <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />}
            </svg>
          </button>
          <Link href={address ? "/app" : "/"} aria-label="Contraflow" className={`items-center gap-2 text-base font-semibold tracking-tight ${address ? "flex lg:hidden" : "flex"}`}>
            <Image src="/logo-mark.png" alt="" width={24} height={24} className="size-6 shrink-0" />
            <span>Contraflow</span>
          </Link>
          {!address && (
            <nav aria-label="Public pages" className="ml-4 hidden items-center gap-1 lg:flex">
              {items.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2/60 hover:text-foreground">
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden lg:block">
            <NetworkChip />
          </div>
          {address ? (
            <AddressMenu address={address} />
          ) : hideHeaderSignIn ? null : (
            <button
              type="button"
              onClick={start}
              disabled={phase === "connecting" || phase === "signing"}
              className="inline-flex h-8 items-center rounded-md px-3 text-sm text-muted hover:text-foreground"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
      {menuOpen && (
        <div id="app-mobile-menu" className="border-t border-border-subtle bg-surface-1 p-3 lg:hidden">
          <div className="mb-3">
            <NetworkChip />
          </div>
          <SidebarNav items={items} onNavigate={() => setMenuOpen(false)} />
        </div>
      )}
    </header>
  );
}
