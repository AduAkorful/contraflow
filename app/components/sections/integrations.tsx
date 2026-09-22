const INTEGRATIONS = [
  "Arc",
  "Swap Kit",
  "Unified Balance",
  "Developer-Controlled Wallets",
  "User-Controlled Wallets",
  "Arc Explorer",
  "Wallet signatures",
  "Native USDC gas",
];

export function Integrations() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-gold">Integrations</p>
        <h2 className="mt-3 font-serif-display text-4xl">Built on Circle and Arc</h2>
        <p className="mt-4 text-muted">
          Real infrastructure, not a simulated backend.
        </p>
      </div>

      <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {INTEGRATIONS.map((name) => (
          <div
            key={name}
            className="flex items-center justify-center rounded-card border border-white/10 bg-white/[0.02] px-4 py-8 text-sm text-muted"
          >
            {name}
          </div>
        ))}
      </div>
    </section>
  );
}
