"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, type NavItem } from "./nav";

export function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="App" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isNavActive(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex h-9 items-center rounded-md px-3 text-sm font-medium ${
              active ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2/60 hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
