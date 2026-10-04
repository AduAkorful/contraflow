import { SiteNav } from "../../components/site-nav";
import { SiteFooter } from "../../components/site-footer";

export const metadata = { title: "Terms of Service" };


const SECTIONS = [
  {
    title: "The service",
    body: [
      "Contraflow is software for netting debts between counterparties. It offers two products. Invoices on Arc are USDC invoices that both parties sign and register on Arc; a closed loop of them is cancelled in one onchain transaction. Offchain obligations are debts in any currency that both parties sign in Contraflow and that stay offchain; a closed loop of them is netted with a certificate every party in the loop signs, which is then applied to Contraflow's netting ledger on Arc.",
      "Contraflow never holds your funds or your keys. Every signature is made with your own wallet.",
    ],
  },
  {
    title: "What a settlement or certificate is",
    body: [
      "A settlement or an applied netting certificate is a record that the parties signed and that Contraflow's contracts checked and applied. It is evidence of what the parties agreed to net. It is used alongside the parties' own commercial agreements and does not replace them, including any netting or master agreement between them.",
      "A settlement or certificate does not by itself discharge, extinguish or derecognise a debt under any legal or accounting standard. How it is treated in your books and contracts is a matter for you and your counterparties.",
    ],
  },
  {
    title: "Your responsibilities",
    body: [
      "You are responsible for the accuracy of what you record, for having the authority to sign for the business you represent, and for keeping your wallet and its keys secure. Transactions on Arc can't be reversed once they're confirmed.",
    ],
  },
  {
    title: "Permissionless settlement",
    body: [
      "Once every party has signed, anyone can submit the transaction that settles a loop of invoices or applies a certificate. Contraflow adds no gatekeeper on top of the parties' signatures.",
    ],
  },
  {
    title: "Circle services",
    body: [
      "A EURC quote is Circle Swap Kit's estimate at the time shown. Contraflow doesn't execute swaps, and a real swap would be subject to fees and slippage.",
      "When you bring USDC from another chain, your own wallet deposits it into Circle Gateway and later asks Circle to deliver it to your own address on Arc. Contraflow isn't a party to those transfers and never holds, routes or controls the funds. Circle's own terms and fees apply, and deposits take time to confirm.",
    ],
  },
  {
    title: "Fees",
    body: [
      "There is no protocol fee today. You pay Arc network gas, in USDC, for the transactions you submit. Recording an obligation involves no transaction. Circle charges its own fees for moving USDC between chains. Fees may be introduced in a future version of the protocol, as described under Upgrades.",
    ],
  },
  {
    title: "Upgrades",
    body: [
      "Contraflow's three contracts, the invoice registry, the settler and the netting ledger, are upgradeable. Upgrades are controlled by a single administrative key held by the Contraflow team, not by a multisig or a governance vote. An upgrade can change how the protocol behaves from that point on, including its fees.",
    ],
  },
  {
    title: "Address screening",
    body: [
      "Contraflow screens addresses against a list it maintains and may decline to process activity involving a listed address. This screening is not an anti-money-laundering or sanctions clearance of you or your counterparties, and Arc's validators do not screen transactions on Contraflow's behalf.",
    ],
  },
  {
    title: "No warranties",
    body: [
      "Contraflow is provided \u201cas is\u201d and \u201cas available\u201d, without warranties of any kind, whether express or implied, including fitness for a particular purpose. Contraflow's contracts have not been through a formal third-party audit. You can check contract addresses and every transaction on the Arc explorer.",
    ],
  },
  {
    title: "Limitation of liability",
    body: [
      "To the fullest extent permitted by law, Contraflow and its team are not liable for any indirect, incidental or consequential loss, or for any loss of funds, profits or data, arising from your use of the service, the Arc network, your wallet or any third-party service.",
    ],
  },
  {
    title: "Changes to these terms",
    body: [
      "We may update these terms. The date at the top of this page shows when they last changed, and continuing to use Contraflow after a change means you accept the updated terms.",
    ],
  },
  {
    title: "Contact",
    body: ["Questions about these terms go through the channels on our Contact page."],
  },
];

export default function TermsPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <SiteNav />
      <main className="relative z-10">
        <section className="mx-auto max-w-3xl px-6 pb-8 pt-10">
          <h1 className="font-serif-display text-5xl leading-[1.05]">Terms of Service</h1>
          <p className="mt-6 text-sm text-muted">Last updated 26 September 2026</p>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-8">
          <div className="space-y-10">
            {SECTIONS.map((s) => (
              <div key={s.title}>
                <h2 className="text-lg font-medium text-gold">{s.title}</h2>
                {s.body.map((p) => (
                  <p key={p.slice(0, 32)} className="mt-2 text-sm text-muted">
                    {p}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
