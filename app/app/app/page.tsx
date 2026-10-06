import Link from "next/link";
import { redirect } from "next/navigation";
import { Overview } from "./Overview";
import { SignInOverlay } from "../../components/overview/SignInOverlay";
import { OverviewIllustration } from "../../components/overview/OverviewIllustration";
import { getSession } from "../../src/session/getSession";
import { safeNextPath } from "../../src/session/nextPath";

export async function generateMetadata() {
  return { title: (await getSession()) ? "Overview" : "Sign in" };
}

export default async function AppLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; switch?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const autoStart = params.switch === "1";
  const session = await getSession();
  if (session && next) redirect(next);

  if (session) {
    return <Overview address={session.address} />;
  }

  return (
    <div className="relative min-h-[calc(100vh-5rem)]">
      <OverviewIllustration />
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg/70 px-4 py-16">
        <SignInOverlay next={next} autoStart={autoStart} />
        <div className="mt-8 grid w-full max-w-md gap-3 sm:grid-cols-2">
          <Link
            href="/app/demo"
            className="rounded-card border border-border-subtle bg-surface-1 px-5 py-4 text-center text-sm hover:bg-surface-2"
          >
            Try the live demo →
          </Link>
          <Link
            href="/app/verify"
            className="rounded-card border border-border-subtle bg-surface-1 px-5 py-4 text-center text-sm hover:bg-surface-2"
          >
            Verify a certificate →
          </Link>
        </div>
      </div>
    </div>
  );
}
