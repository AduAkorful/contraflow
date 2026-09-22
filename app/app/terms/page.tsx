import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

const SECTIONS = [
  {
    title: "What Contraflow is",
    body: "Contraflow is a protocol on Arc that finds closed cycles of invoices — debts that cancel each other out — and settles them in a single transaction. This is an early release: a working proof of concept, not a production clearing house.",
  },
  {
    title: "What Contraflow is not",
    body: "Contraflow is not a central counterparty, a licensed netting service, an ERP integration, or an automated FX engine. Cancelling a cycle on-chain does not constitute a statutory legal discharge of debt under any accounting or legal standard. Treat an on-chain cancellation as exactly that — a verifiable on-chain event, not a legal opinion.",
  },
  {
    title: "Permissionless settlement",
    body: "Once every party has signed off, anyone can submit the transaction that finalizes a cycle — Contraflow doesn't add an extra gatekeeper on top of the signatures already collected.",
  },
  {
    title: "Fees",
    body: "There is currently no protocol fee. You pay standard Arc network gas and nothing else. Fee terms may change in future versions of the protocol — see Upgrades below.",
  },
  {
    title: "Upgrades",
    body: "Contraflow's smart contracts are upgradeable. A single administrative key held by the team controls upgrades — not a multisig or a DAO vote. An upgrade can change how the protocol behaves, including its fees, for invoices registered afterward. This is a real point of trust in the team; don't use Contraflow for anything where that isn't acceptable to you.",
  },
  {
    title: "Compliance",
    body: "In this phase, address screening is a manually maintained list, not a full compliance vendor integration, and Arc validators do not screen transactions. Using Contraflow is not AML/OFAC clearance.",
  },
  {
    title: "Use at your own risk",
    body: "This is early-stage software interacting with real funds on a real blockchain, and has not been through a formal third-party audit. Verify contract addresses and transaction results yourself on the Arc explorer before relying on anything shown in the app.",
  },
];

export default function TermsPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-3xl px-6 pb-8 pt-10">
          <h1 className="font-serif-display text-5xl leading-[1.05]">Terms</h1>
          <p className="mt-6 text-muted">
            Short and plain-language, not a substitute for legal advice. Here's what's actually true
            about the protocol.
          </p>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-8">
          <div className="space-y-10">
            {SECTIONS.map((s) => (
              <div key={s.title}>
                <h2 className="text-lg font-medium text-gold">{s.title}</h2>
                <p className="mt-2 text-sm text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
