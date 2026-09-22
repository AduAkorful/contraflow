import Link from "next/link";

const PRIMARY_LINKS = [
  { label: "About", href: "/about" },
  { label: "Features", href: "/features" },
  { label: "Pricing", href: "/pricing" },
  { label: "Integrations", href: "/integrations" },
  { label: "Contact", href: "/contact" },
];

export function SiteNav() {
  return (
    <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6">
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

      <Link
        href="/app"
        className="shrink-0 whitespace-nowrap rounded-pill bg-foreground px-5 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
      >
        Launch App
      </Link>
    </header>
  );
}
