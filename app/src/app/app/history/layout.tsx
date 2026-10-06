import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invoice history",
  description: "Invoices registered for an address, and whether a loop has netted them.",
  alternates: { canonical: "/app/history" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
