import { LandingClient } from "./LandingClient";

export const metadata = { title: "Review an invoice" };


export default async function AttestLandingPage({ params }: { params: Promise<{ encoded: string }> }) {
  const { encoded } = await params;

  return (
    <>
      <section className="mx-auto max-w-xl px-6 py-16">
        <LandingClient encoded={encoded} />
      </section>
    </>
  );
}
