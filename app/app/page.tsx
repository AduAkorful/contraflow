import { SiteNav } from "../components/site-nav";
import { SiteFooter } from "../components/site-footer";
import { Hero } from "../components/sections/hero";
import { WhyUs } from "../components/sections/why-us";
import { KeyFeatures } from "../components/sections/key-features";
import { Values } from "../components/sections/values";
import { Cta } from "../components/sections/cta";
import { HowItWorks } from "../components/sections/how-it-works";
import { Integrations } from "../components/sections/integrations";
import { Pricing } from "../components/sections/pricing";
import { Faq } from "../components/sections/faq";
import { ProtocolStatsSection } from "../components/sections/protocol-stats";

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <Hero />
        <WhyUs />
        <KeyFeatures />
        <Values />
        <Cta />
        <HowItWorks />
        <ProtocolStatsSection />
        <Integrations />
        <Pricing />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
