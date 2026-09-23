# Using the app

## Connect and sign in

Connect a wallet from the app, then sign a one-time message to prove you control it. This creates
a session — nothing about which invoices are yours is ever taken from a value you type in, only
from that verified session.

The first time a new address connects, it receives a small, one-time starter grant of native gas
so it can submit its own first transaction. Every action after that — including that first one —
is submitted by your own wallet, never relayed on your behalf.

## Propose an invoice

1. Pick whether you're the debtor ("I owe them") or the creditor ("They owe me").
2. Enter the counterparty's address, the amount, and a maturity date.
3. Describe what the invoice is for. This description is hashed and becomes part of what you
   sign — your counterparty sees the same description before they sign, and their browser
   independently checks that the hash matches before showing them anything. A tampered link is
   rejected outright, not shown with a warning.
4. Sign with your wallet. This generates a link.

## Share the link

Send the link to your counterparty through whatever channel you already use — it carries
everything they need and requires no account on their end beyond connecting their own wallet.
Nothing is registered on-chain yet.

## Your counterparty reviews and signs

They open the link, see the same terms and description you signed, and sign with their own
wallet. Their own wallet then submits the registration transaction directly — not the app, not the
operator.

## Cycle discovery and settlement

Once enough mutually-attested invoices exist to close a cycle, anyone can submit the settlement.
The contract cancels the shared amount across every invoice in the cycle in one transaction. You
get a receipt: the block, the transaction, and exactly what changed for every invoice involved.

## Demo mode

A separate demo mode runs the same attest → register → settle sequence with sample fixture data,
for anyone who wants to see a full cycle without lining up a real counterparty first. It's clearly
labeled as a demo and uses freshly generated test identities, never real invoices.
