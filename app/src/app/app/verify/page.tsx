import { VerifyCertificate } from "./VerifyCertificate";

import { pageMeta } from "@/src/site/pageMeta";

export const metadata = pageMeta(
  "/app/verify",
  "Verify a netting certificate",
  "Check an exported Contraflow netting certificate against the Arc ledger, in your browser.",
);

export default function VerifyPage() {
  return (
    <>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="heading-1">Verify a certificate</h1>
        <p className="mt-4 text-sm text-muted">
          Check an exported netting certificate against the ledger on Arc. Every check runs in this browser; the file
          is never uploaded.
        </p>
        <VerifyCertificate />
      </section>
    </>
  );
}
