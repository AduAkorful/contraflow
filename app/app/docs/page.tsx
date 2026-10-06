import Link from "next/link";
import spec from "../../public/api/v1/openapi.json";
import { MarketingPage } from "../../components/marketing/MarketingPage";

export const metadata = {
  title: "Docs",
  description: "Contraflow API v1: parties grant scoped permissions, tenants submit signatures, Contraflow never holds keys.",
};

export default function DocsPage() {
  const info = spec.info as { title?: string; version?: string; description?: string };
  const paths = Object.keys(spec.paths ?? {});
  return (
    <MarketingPage>
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="heading-1">Docs</h1>
        <p className="mt-4 text-sm text-muted">
          {info.description ?? "Offchain obligations API. Contraflow never signs for API users: tenants deliver signatures the parties made."}
        </p>
        <p className="mt-4 text-sm text-muted">
          Machine-readable spec:{" "}
          <a href="/api/v1/openapi.json" className="text-gold hover:underline">
            /api/v1/openapi.json
          </a>
          . Keys are operator-issued. Request one through{" "}
          <Link href="/contact" className="text-gold hover:underline">
            Contact
          </Link>
          .
        </p>
        <h2 className="mt-10 text-sm font-semibold">Quick start</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Ask for a test key (`cfk_test_…`).</li>
          <li>Have the party sign the permission typed data, then `POST /api/v1/permissions`.</li>
          <li>Call party-scoped endpoints with `Authorization: Bearer` and `Idempotency-Key` on writes.</li>
        </ol>
        <h2 className="mt-10 text-sm font-semibold">
          {info.title ?? "API"}
          {info.version ? ` · v${info.version}` : ""}
        </h2>
        <ul className="mt-3 space-y-1 font-mono text-sm text-muted">
          {paths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      </div>
    </MarketingPage>
  );
}
