import Image from "next/image";
import Link from "next/link";
import { appNavItems } from "./nav";
import { SidebarNav } from "./SidebarNav";
import { TopBar } from "./TopBar";

/// Chrome for every `/app` page. Signed in: a sidebar plus a top bar with the network and the
/// address menu. Signed out: the top bar alone, with the public destinations, so a shared receipt
/// or verify link doesn't open onto a menu of pages that need an account.
export function AppShell({
  address,
  balanceEnabled,
  docs,
  children,
}: {
  address: string | null;
  balanceEnabled: boolean;
  docs?: { href: string; external: boolean };
  children: React.ReactNode;
}) {
  const items = appNavItems({ balance: balanceEnabled, docs });
  const signedOutItems = items.filter((i) => ["/app/history", "/app/verify", "/app/demo"].includes(i.href) || i.label === "Docs");

  return (
    <div className={`min-h-screen bg-bg ${address ? "lg:grid lg:grid-cols-[232px_minmax(0,1fr)]" : ""}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:text-black"
      >
        Skip to content
      </a>

      {address && (
        <aside className="hidden border-r border-border-subtle bg-surface-1 lg:block">
          <div className="sticky top-0 flex h-screen flex-col px-3 py-5">
            <Link href="/app" className="mb-6 flex items-center gap-2 px-2 text-base font-semibold tracking-tight">
              <Image src="/logo-mark.png" alt="" width={24} height={24} className="size-6 shrink-0" />
              Contraflow
            </Link>
            <SidebarNav items={items} />
            <div className="mt-auto flex flex-col gap-1 px-2 text-xs text-faint">
              <Link href="/" className="hover:text-foreground">
                Contraflow website
              </Link>
              <Link href="/terms" className="hover:text-foreground">
                Terms
              </Link>
              <Link href="/privacy" className="hover:text-foreground">
                Privacy
              </Link>
            </div>
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-col">
        <TopBar address={address} items={address ? items : signedOutItems} />
        <main id="main" className="flex-1">
          {children}
        </main>
        {!address && (
          <footer className="border-t border-border-subtle px-6 py-6 text-xs text-faint">
            <div className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-2">
              <Link href="/" className="hover:text-foreground">
                Contraflow website
              </Link>
              <Link href="/terms" className="hover:text-foreground">
                Terms
              </Link>
              <Link href="/privacy" className="hover:text-foreground">
                Privacy
              </Link>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
