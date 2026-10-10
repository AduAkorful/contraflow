import { MarketingPage } from "@/components/marketing/MarketingPage";
import { LegalDoc } from "@/components/marketing/LegalDoc";
import { pageMeta } from "@/src/site/pageMeta";

export const metadata = pageMeta(
  "/privacy",
  "Privacy Policy",
  "What Contraflow stores, who can read it, and what Arc records in public.",
);

const SECTIONS = [
  {
    title: "Signing in",
    body: [
      "You sign in with a wallet, either one you already use or one Privy creates for you when you sign in with your email. Privy handles email sign-in; Contraflow receives your wallet address, not your email. Signing in sets one cookie, a signed session that holds your wallet address and expires after 24 hours.",
    ],
  },
  {
    title: "What we store, and who can read it",
    body: [
      "For invoices, Arc publicly records the debtor and creditor addresses, amount, maturity and invoice reference. We separately store the description you write. New invoice links don't contain the description: one of the two parties must sign in before the app loads it. Older links may contain the description directly, so anyone who already has one of those links can still read it.",
      "For offchain obligations, we store each obligation you and your counterparty sign: the parties, amount, currency, maturity, description and signatures, and its remaining balance. Each obligation's terms are shown only to its two parties. Everyone in a loop sees the addresses in it. For a netting certificate, each party sees only their own obligations and the amount netted.",
      "Contraflow itself can read everything stored here, including every obligation submitted to it. It needs obligations to find loops to net.",
      "We also record which addresses have received the one-time starter gas grant.",
    ],
  },
  {
    title: "Platforms that act for you",
    body: [
      "If you use Contraflow through another platform, it can act for you only after you sign a permission for it. The permission lists what the platform may do, reading your obligations, proposing new ones or passing on signatures you made, and it expires within a year. A platform can never sign for you, and it only sees what that permission covers.",
    ],
  },
  {
    title: "API usage records",
    body: [
      "For each API tenant, we keep daily counts of its calls: which operation, which party it acted for, whether the call succeeded and, if not, the error code. We don't keep request contents, amounts, descriptions or IP addresses in these counts. They are kept for 90 days and are shown only to that tenant.",
    ],
  },
  {
    title: "What's public onchain",
    body: [
      "Arc is a public blockchain. For invoices, the debtor and creditor addresses, the amount and the terms are public once registered, along with every settlement.",
      "For offchain obligations, the amounts, currency and descriptions never go onchain. What is public is the addresses that took part in each netting certificate, the shape of the loop (who owes whom), and a blinded record of each obligation's state and when it changed. Participation is therefore not anonymous.",
    ],
  },
  {
    title: "Rate limiting",
    body: [
      "To protect the service, we count requests per IP address in short windows of about a minute. These counters expire on their own.",
    ],
  },
  {
    title: "Service providers",
    body: [
      "Contraflow runs on Vercel (hosting), Supabase (database), Upstash (rate limits and caching) and Privy (sign-in), and reads public chain data from the Arc explorer. EURC quotes come from Circle; Contraflow's server asks for them with an invoice's amount and nothing about you. Each processes data only to provide its part of the service.",
      "When you bring USDC from another chain, your browser talks to Circle directly: it sends your wallet address to read your Gateway balance, and your wallet sends Circle the transfers you sign. Contraflow's servers aren't involved.",
    ],
  },
  {
    title: "What we don't do",
    body: ["We don't sell your data, and we don't use advertising trackers or third-party analytics."],
  },
  {
    title: "Contact",
    body: ["Questions about your data go through the channels on our Contact page."],
  },
];

export default function PrivacyPage() {
  return (
    <MarketingPage>
      <LegalDoc
        title="Privacy Policy"
        updated="2 October 2026"
        summary="We store what you and your counterparty sign. Invoice amounts and parties are public on Arc. Obligation amounts stay offchain, but Contraflow can read them. We don't sell data or run ads."
        sections={SECTIONS}
      />
    </MarketingPage>
  );
}
