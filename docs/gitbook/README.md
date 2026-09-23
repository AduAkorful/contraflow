# Contraflow

Contraflow finds closed cycles among bilaterally-attested invoices on Arc and cancels the whole
cycle in one on-chain transaction — no USDC moves except gas.

If a DSP owes an ad exchange $100k, the exchange owes a publisher $100k, and the publisher owes
the DSP $100k, that's $300,000 sitting immobilized across three balance sheets for a net economic
transfer of exactly $0. Contraflow finds that cycle and cancels it directly, instead of routing
three separate payments through it.

## What's in these docs

- [How it works](how-it-works.md) — the actual mechanism: attestations, cycle-finding, and what
  `settle()` does and doesn't do.
- [Using the app](using-the-app.md) — a walkthrough of composing, signing, and settling a real
  invoice.
- [FAQ](faq.md) — the questions this document answers plainly rather than gesturing past.
- [API (coming soon)](api/README.md) — not available yet.

## What Contraflow is not

Not a CCP, not a legal netting service, not an ERP plugin, and not an atomic FX/Gateway engine.
It's a protocol for cancelling matched, mutually-attested obligations in place. Anything beyond
that — currency conversion, moving funds across chains, legal extinguishment of debt — is a
separate, clearly-labeled step, never folded into the cancel transaction itself.
