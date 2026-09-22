import { Providers } from "./providers";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
