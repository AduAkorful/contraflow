import { SiteFooter } from "../site-footer";
import { SiteNav } from "../site-nav";

export function MarketingPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg">
      <SiteNav />
      <main id="main" className="relative z-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
