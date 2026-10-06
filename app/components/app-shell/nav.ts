export interface NavItem {
  label: string;
  href: string;
  /// Paths that belong to this item without being under its href (e.g. a certificate link opens
  /// from the Obligations area).
  alsoActiveFor?: readonly string[];
  /// Opens another site (the docs) in a new tab; never marked active.
  external?: boolean;
}

/// Sidebar and mobile menu, in one place. Balance is only offered when the feature is on; the
/// page decides that on the server and passes the flag in.
export function appNavItems(options: { balance: boolean; docsUrl?: string | null }): NavItem[] {
  return [
    { label: "Overview", href: "/app" },
    { label: "Send invoice", href: "/app/attest", alsoActiveFor: ["/app/i/"] },
    { label: "History", href: "/app/history", alsoActiveFor: ["/app/receipt"] },
    { label: "Obligations", href: "/app/obligations", alsoActiveFor: ["/app/o/", "/app/c/"] },
    ...(options.balance ? [{ label: "Balance", href: "/app/balance" }] : []),
    { label: "Verify", href: "/app/verify" },
    { label: "Demo", href: "/app/demo" },
    ...(options.docsUrl ? [{ label: "Docs", href: options.docsUrl, external: true }] : []),
  ];
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.external) return false;
  if (item.href === "/app") return pathname === "/app";
  const prefixes = [item.href, ...(item.alsoActiveFor ?? [])];
  return prefixes.some((prefix) =>
    prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
