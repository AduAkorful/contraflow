import { SiteNav } from "../../../../components/site-nav";
import { SiteFooter } from "../../../../components/site-footer";
import { LandingClient } from "./LandingClient";

export default async function AttestLandingPage({ params }: { params: Promise<{ encoded: string }> }) {
  const { encoded } = await params;

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-xl px-6 py-16">
          <LandingClient encoded={encoded} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
