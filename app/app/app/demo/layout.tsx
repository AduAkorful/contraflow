import type { Metadata } from "next";

export const metadata: Metadata = { title: "Live demo" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
