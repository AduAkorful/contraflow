# Roadmap

Contraflow nets what businesses owe each other on a shared, verifiable ledger. Today that netting is a signed record that works alongside your agreements: it doesn't replace them, and it doesn't by itself discharge a debt under any legal or accounting standard. Our direction is to make that record count for more in the real world.

Nothing on this page is available today. The items below are directions, not commitments, and there are no dates. The rest of these docs describe what Contraflow does now.

## Netting that reaches the real debt

* **Tokenized receivables and real-world assets.** Invoices and obligations represented as onchain assets, so that netting a loop reduces the asset itself, not just a record of it. This would open netted positions to financing, transfer and audit in the same place they're cleared.
* **Evidence-linked obligations.** Each obligation anchored to its source: a purchase order, a delivery record, a payment, or a tokenized claim. Counterparties, auditors and financiers could trace every netted amount back to what created it. That would make a record easier to check. It wouldn't make Contraflow the judge of whether a debt is good.
* **Recognized discharge.** Netting certificates that companies could rely on to close debts in their books and agreements, not only onchain. That depends on legal and accounting review, and it isn't something the product claims today.

## Settling what remains

* **Remainder payments.** After a loop is netted, most invoices keep a remaining balance. Today the app shows it, gives a EURC quote, and lets you move USDC to your own wallet and send it. The next step is a guided payment of the remainder directly between the two parties, in USDC or EURC, signed from their own wallets.
* **Multi-currency netting.** Loops that span currencies, with the remainder settled in whichever currency each party holds.

## Built into how companies operate

* **Accounting and ERP connectors.** Accounting, ERP and treasury systems can use the [API](api.md) today. Ready-made connectors would let a netted loop flow straight into a company's own books without custom work.
* **Network-wide optimization.** Today each search finds the best loop for the party who asks, and loops are taken first come, first served. A search across all participants at once would clear more of what's owed.

## What stays the same

The properties in [Trust and security](how-it-works.md#trust-and-security) are what any of this is meant to preserve:

* Contraflow never signs for you. A debt is only netted with the signature of every party it affects.
* Netting moves no tokens. It cancels obligations against each other.
* Your funds stay in your wallets.
