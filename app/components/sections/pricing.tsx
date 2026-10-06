import { NetworkNotice } from "../network/NetworkNotice";

const GAS_COSTS = [
  { call: "Record an offchain obligation", cost: "No gas" },
  { call: "Apply a netting certificate (3 obligations)", cost: "~$0.0042" },
  { call: "Attest an invoice", cost: "~$0.0072" },
  { call: "Settle a 3-invoice cycle", cost: "~$0.0043" },
  { call: "Settle a 4-invoice cycle", cost: "~$0.0052" },
  { call: "Settle a 5-invoice cycle", cost: "~$0.0061" },
];

export function Pricing() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">Pricing</p>
        <h2 className="mt-3 font-serif-display text-4xl">$0 protocol fee</h2>
        <p className="mt-4 text-muted">
          Netting costs nothing on Contraflow today. You only pay Arc network gas, priced in USDC, and
          recording an obligation costs nothing at all.
        </p>
      </div>

      <NetworkNotice className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted" />

      <div className="mx-auto mt-4 max-w-2xl rounded-card border border-border-subtle bg-surface-1">
        <div className="flex justify-between gap-4 border-b border-border-subtle px-5 py-3 text-xs font-medium text-faint">
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
        <p className="border-t border-border-subtle px-5 py-4 text-xs text-muted">
          Gas costs vary with network conditions. Figures above are typical, not guaranteed.
        </p>
      </div>
    </section>
  );
}
