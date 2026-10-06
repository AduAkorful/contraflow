import Link from "next/link";
import { SiteNav } from "../components/site-nav";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(100deg,transparent_0px,transparent_60px,rgba(245,190,9,0.06)_60px,rgba(245,190,9,0.06)_62px)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60"
      />

      <SiteNav />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="font-serif-display text-[7rem] leading-none text-gold/70 sm:text-[9rem]">
          404
        </h1>
        <p className="mt-6 max-w-sm text-muted">
          Sorry, the page you are looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-8 rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02]"
        >
          Home
        </Link>
        <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
          <Link href="/app/demo" className="text-gold hover:underline">
            Demo
          </Link>
          <Link href="/app/verify" className="text-gold hover:underline">
            Verify a certificate
          </Link>
          <Link href="/docs" className="text-gold hover:underline">
            Docs
          </Link>
        </div>
      </main>
    </div>
  );
}
