import { LandingClient } from "../../attest/[encoded]/LandingClient";

export const metadata = { title: "Review an invoice" };

export default async function ShortInvoiceLandingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <section className="mx-auto max-w-xl px-6 py-16">
      <LandingClient token={token} />
    </section>
  );
}
