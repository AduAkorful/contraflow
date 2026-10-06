import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try a loop",
  description: "Watch a loop of invoices net in one transaction on Arc, with fixture companies and no second party.",
  alternates: { canonical: "/app/demo" },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
