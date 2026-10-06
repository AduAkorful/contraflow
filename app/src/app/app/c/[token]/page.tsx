import { CertificateLanding } from "./CertificateLanding";

export const metadata = { title: "Netting certificate" };


export default async function CertificatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <>
      <section className="mx-auto max-w-xl px-6 py-16">
        <CertificateLanding token={token} />
      </section>
    </>
  );
}
