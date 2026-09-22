const GAS_COSTS = [
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
          Netting your invoices costs nothing. You only ever pay Arc network gas, priced in USDC.
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-2xl overflow-x-auto rounded-card border border-white/10">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left">
              <th className="p-4 font-medium text-muted">Action</th>
              <th className="p-4 font-medium text-gold">Typical gas cost</th>
            </tr>
          </thead>
          <tbody>
            {GAS_COSTS.map((row) => (
              <tr key={row.call} className="border-b border-white/5">
                <td className="p-4">{row.call}</td>
                <td className="p-4 text-gold">{row.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-white/10 p-4 text-xs text-muted">
          Gas costs vary with network conditions — figures above are typical, not guaranteed.
        </p>
      </div>
    </section>
  );
}
