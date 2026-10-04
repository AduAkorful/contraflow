import { SiteNav } from "../../../../components/site-nav";
import { SiteFooter } from "../../../../components/site-footer";
import { ProposalLanding } from "./ProposalLanding";

export const metadata = { title: "Obligation" };


export default async function ProposalLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-xl px-6 py-16">
          <ProposalLanding token={token} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
