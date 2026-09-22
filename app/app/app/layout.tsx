import { Providers } from "./providers";

/// `PrivyProvider` validates its `appId` synchronously on init and throws on an invalid one — a
/// real problem only during static prerendering (which runs at build time, before a real App ID
/// necessarily exists yet), not at runtime in the browser. This whole segment is wallet-interactive
/// client UI anyway, so there's nothing worth prerendering statically here.
export const dynamic = "force-dynamic";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
