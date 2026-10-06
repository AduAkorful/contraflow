import { ProposalLanding } from "./ProposalLanding";

export const metadata = { title: "Obligation" };


export default async function ProposalLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <>
      <section className="mx-auto max-w-xl px-6 py-16">
        <ProposalLanding token={token} />
      </section>
    </>
  );
}
