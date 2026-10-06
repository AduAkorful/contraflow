import { Hero } from "@/components/sections/hero";
import { ProofStrip } from "@/components/sections/proof-strip";
import { HowItWorks } from "@/components/sections/how-it-works";
import { WhoItsFor } from "@/components/sections/who-its-for";
import { TwoRails } from "@/components/sections/two-rails";
import { VerifyYourself } from "@/components/sections/verify-yourself";
import { PricingTeaser } from "@/components/sections/pricing-teaser";
import { Developers } from "@/components/sections/developers";
import { Faq } from "@/components/sections/faq";
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
      <ProofStrip />
      <HowItWorks />
      <WhoItsFor />
      <TwoRails />
      <VerifyYourself />
      <PricingTeaser />
      <Developers />
      <Faq />
      <Cta />
    </MarketingPage>
  );
}
