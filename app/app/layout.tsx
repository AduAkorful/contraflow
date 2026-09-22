import type { Metadata } from "next";
import { Instrument_Serif, Inter_Tight } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-inter-tight",
});

export const metadata: Metadata = {
  title: "Contraflow — Cancel circular debt on Arc",
  description:
    "Contraflow finds closed cycles of invoices and cancels them in one transaction, so no USDC moves except gas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} ${interTight.variable}`}>
      <body>{children}</body>
    </html>
  );
}
