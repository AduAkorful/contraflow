# Offchain obligations

Offchain obligations let you net debts in the currency you actually invoice in, with the amounts
kept off the chain.

## Recording an obligation

An obligation is a debt between two parties: who owes whom, the amount and currency, a maturity
date, whether it can be netted before maturity, and a description. One party proposes it and signs
it with their wallet. Contraflow gives them a short link to send to the counterparty.

Only the counterparty can open that link, after signing in with the wallet it names. Their browser
checks the proposer's signature and the description before they see anything, and a link that
fails either check is rejected. When they sign too, the obligation is recorded. Nothing goes
onchain, and it costs no gas.

## How netting works

When your obligations and other parties' obligations in the same currency form a closed loop,
Contraflow can propose a **netting certificate** for it: every obligation in the loop comes down by
the same amount, the smallest one in the loop.

Each party opens the certificate and sees only their own obligations in it, plus the amount being
netted. Their browser checks the certificate before they sign. Once everyone has signed, any party
can apply it to Contraflow's netting ledger on Arc. A certificate that isn't fully signed and
applied within 7 days expires.

## Why the same debt can't be netted twice

The ledger stores a blinded fingerprint of each obligation's current state. A certificate says
which state it starts from and which state it moves to, and the ledger only accepts it if the start
matches what's recorded. Once applied, the old state is gone, so no certificate built on it can
ever be applied again.

The fingerprints are blinded with a random value, so the amounts can't be worked out from them,
even for round numbers.

## Keeping your certificate

From a certificate's page you can download your copy. It contains your own obligations in full,
every party's signature, and what's needed to check it against the ledger. It doesn't contain
anyone else's amounts.

## Checking a certificate yourself

Open **Verify a certificate** in the app (`/app/verify`, linked from the site footer) and choose a
certificate file. Your
browser checks every signature, recomputes the certificate's fingerprints and compares them with
the ledger on Arc. Nothing is uploaded, and you don't need to sign in.

## What's public

On Arc, anyone can see which addresses took part in each certificate, the shape of the loop (who
owes whom), and when each obligation's state changed. The amounts, the currency and your
descriptions never go onchain.
