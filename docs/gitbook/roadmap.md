# Roadmap

Nothing on this page is available today. It describes directions, not commitments, and there are no dates. The rest of these docs describe what Contraflow does now.

## What this page is about

Contraflow records and nets what parties have signed that they owe each other. It isn't connected to anyone's bank account or treasury, or to the real-world asset behind a debt, and it holds no funds. When a loop is netted, the record changes. The money you are still owed, or still owe, moves the way it did before.

Most of what follows is about narrowing that gap without changing what netting is.

## From a netted record to real funds

* **Paying what's left, in the app.** After a loop is netted, most invoices keep a remaining balance. Today the app shows it, gives a EURC quote, and lets you move USDC to your own wallet and send it. The next step is a guided payment of the remainder between the two parties, including in another currency through Circle's tooling. Each step would be signed by the party's own wallet, and fees and rates would apply, as they do for the quote today.
* **Showing what a debt is backed by.** An obligation carries a description and a hash of its document. We'd like an obligation to be able to point at its evidence: a purchase order, a delivery record, a payment, or an onchain representation of a real-world asset such as a tokenized receivable. That would make a record easier to check. It wouldn't make Contraflow the judge of whether a debt is good.
* **Connectors for the systems companies already use.** Accounting, ERP and treasury systems can use the [API](api.md) today. Ready-made connectors would let a netted loop update a company's own books without custom work.
* **Holding or moving funds for a company.** Connecting to bank accounts, or holding funds on someone's behalf, is a different product from the one these docs describe. It would involve regulated partners and legal review, and it isn't part of Contraflow today.

## Better loop search

* **Finding the best loops across everyone.** Today each search finds the best loop for the party who asks, and loops are taken first come, first served. A search across all participants at once would net more of what's owed.

## What stays the same

The properties in [Trust and security](how-it-works.md#trust-and-security) are what any of this is meant to preserve:

* Contraflow doesn't sign for you, and a debt is only netted with the signature of every party it affects.
* A netted record works alongside your agreements. It doesn't replace them, and it doesn't by itself discharge a debt under any legal or accounting standard.
