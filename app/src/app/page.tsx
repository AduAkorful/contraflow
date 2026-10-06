import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Cta } from "@/components/sections/cta";
import { MarketingPage } from "@/components/marketing/MarketingPage";

export const metadata = {
  description: "When A owes B, B owes C and C owes A, Contraflow nets the loop in one signed step. No cash moves.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <MarketingPage>
      <Hero />
      <HowItWorks />
      <Cta />
    </MarketingPage>
  );
}
