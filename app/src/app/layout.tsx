import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
});

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
});

const SITE_TITLE = "Contraflow — Cancel circular debt on Arc";
const SITE_DESCRIPTION =
  "Contraflow finds loops of debt between counterparties and nets them out: USDC invoices in one transaction on Arc, and obligations in any currency with one certificate everyone signs.";

function metadataBase(): URL | undefined {
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  if (!domain) return undefined;
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(domain);
  try {
    return new URL(`${local ? "http" : "https"}://${domain}`);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  title: { default: SITE_TITLE, template: "%s · Contraflow" },
  description: SITE_DESCRIPTION,
  openGraph: { siteName: "Contraflow", title: SITE_TITLE, description: SITE_DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
