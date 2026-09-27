# Contraflow

Contraflow finds loops of debt between counterparties and nets them out, so money that would only
go round in a circle never has to move.

If a DSP owes an ad exchange $100k, the exchange owes a publisher $100k, and the publisher owes
the DSP $100k, that's $300,000 tied up across three balance sheets for a net transfer of exactly
$0. Contraflow finds that loop and nets it out directly, instead of routing three payments round
it.

## Two products

- **Invoices on Arc.** USDC invoices that both parties sign and register on Arc. A loop of them
  is cancelled in one transaction that anyone can submit.
- **Offchain obligations.** Debts in any currency that both parties sign and that stay offchain.
  A loop of them nets out with one certificate everyone in it signs, recorded on Arc so the same
  debt can never be netted twice.

## What's in these docs

- [How it works](how-it-works.md): how both products work, and the trust and security model.
- [Offchain obligations](offchain-obligations.md): recording obligations, netting certificates,
  and checking a certificate yourself.
- [Using the app](using-the-app.md): a step-by-step walkthrough.
- [FAQ](faq.md)
- [API](api/README.md): for platforms that net obligations for their customers.

For developers, integrators and reviewers, the **Reference** section goes deeper:
[architecture](reference/architecture.md), [contracts](reference/contracts.md), the
[offchain netting protocol](reference/offchain-netting.md), the [API reference](reference/api.md), the
[security model](reference/security.md) and the [data model](reference/data-model.md).
