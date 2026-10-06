import Link from "next/link";
import { MarketingPage } from "@/components/marketing/MarketingPage";
import { NetworkNotice } from "@/components/network/NetworkNotice";
import { APP_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "@/src/contracts/addresses";
import { pageMeta } from "@/src/site/pageMeta";

export const metadata = pageMeta(
  "/pricing",
  "Pricing",
  "No protocol fee today. You pay Arc's network fee, a fraction of a cent, from your own wallet.",
);

const GAS_COSTS = [
  { call: "Record an offchain obligation", cost: "No gas" },
  { call: "Apply a netting certificate (3 obligations)", cost: "~$0.0042" },
  { call: "Attest an invoice", cost: "~$0.0072" },
  { call: "Settle a 3-invoice cycle", cost: "~$0.0043" },
  { call: "Settle a 4-invoice cycle", cost: "~$0.0052" },
  { call: "Settle a 5-invoice cycle", cost: "~$0.0061" },
];

export default function PricingPage() {
  return (
    <MarketingPage>
      <section className="mx-auto max-w-4xl px-6 pb-4 pt-10 text-center">
        <h1 className="font-serif-display text-5xl leading-[1.05]">$0 protocol fee</h1>
        <p className="mx-auto mt-6 max-w-xl text-muted">
          Netting costs nothing on Contraflow today. You only pay Arc network gas, priced in USDC,
          and recording an obligation costs nothing at all.
        </p>
      </section>

      <section className="mx-auto max-w-2xl px-6 py-12">
        <NetworkNotice className="text-center text-sm text-muted" />
        <p className="mt-4 text-center text-sm text-muted">
          {APP_CHAIN_ID === ARC_TESTNET_CHAIN_ID ? "Measured on Arc Testnet" : "Measured on Arc"}
        </p>
        <div className="mt-4 rounded-card border border-border-subtle bg-surface-1">
          <div className="flex justify-between gap-4 border-b border-border-subtle px-5 py-3 text-sm font-medium text-faint">
            <span>Action</span>
            <span>Typical gas cost</span>
          </div>
          <dl>
            {GAS_COSTS.map((row) => (
              <div
                key={row.call}
                className="flex flex-col gap-0.5 border-b border-border-subtle px-5 py-4 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <dt>{row.call}</dt>
                <dd className="font-medium tabular-nums text-gold">{row.cost}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-border-subtle px-5 py-4 text-sm text-muted">
            Gas costs vary with network conditions. Figures above are typical, not guaranteed.
          </p>
        </div>
        <div className="mt-10 rounded-card border border-border-subtle bg-surface-1 p-6">
          <h2 className="text-lg font-medium">Will this stay free?</h2>
          <p className="mt-2 text-sm text-muted">
            There is no protocol fee today. A future upgrade could introduce one; that&apos;s in the{" "}
            <Link href="/terms#fees" className="text-gold hover:underline">
              Terms
            </Link>
            . There are no subscriptions or per-loop tolls.
          </p>
        </div>
        <p className="mt-10 text-center">
          <Link href="/app" className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black">
            Start free
          </Link>
        </p>
      </section>
    </MarketingPage>
  );
}
