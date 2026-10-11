# Using the app

## Sign in

Sign in with the wallet you already use, or with your email, and sign a one-time message to prove
you control the wallet. That starts a session. Which invoices and obligations are yours is always
taken from that session, never from anything typed into a form.

Signing in costs nothing: it is a signature, not a transaction. The first time an address signs in it gets a
small one-time grant of gas, and a notice tells you it arrived. If that didn't go through, it is sent just before
your first transaction instead. Every transaction after that is sent from your own wallet.

## Overview

After you sign in, Overview shows your position first (USDC from your invoice history, then each
obligation currency), then any loop that's ready to net, then what's waiting on you beside recent
activity. Send an invoice and record a debt are further down. Overview shows only your own details.

## Invoices on Arc

### Send an invoice

1. Choose whether you're the debtor ("I owe them") or the creditor ("They owe me").
2. Enter the counterparty's address, the amount in USDC and a maturity date.
3. Describe what the invoice is for. The description becomes part of what you sign, so your
   counterparty's browser can check it's exactly what you wrote. A link that's been tampered with
   is rejected outright.
4. Sign. This gives you a short link (`/app/i/…`) to send to your counterparty. It works for 30 days.

### Your counterparty signs

They sign in, open the link, see the same terms and description you signed, and sign. Their wallet
then registers the invoice on Arc. Only the two parties can load the link.

### Settlement

When registered invoices form a loop, anyone can settle it. One transaction reduces every invoice
in the loop by the same amount, and you get a receipt showing the block, the transaction and
exactly what changed for each invoice.

## Offchain obligations

### Record a debt

1. From the app's home page, open **Record a debt (any currency)**.
2. Choose whether you owe or are owed, then enter the counterparty's address, the currency, the
   amount, a maturity date and a description.
3. Sign. You get a short link to send to your counterparty. It works for 30 days.

### Your counterparty signs

Only they can open the link, after signing in with the wallet it names. Their browser checks your
signature and the description, then they sign. The obligation appears on both parties'
Obligations pages. No transaction is involved.

### Net a loop

1. On **Obligations**, choose **Find a netting loop**. If your obligations close a loop with other
   parties' obligations in the same currency, Contraflow proposes a certificate.
2. Open the certificate. Your browser checks it, and you see your own obligations in it and the
   amount being netted. Choose **Sign certificate**.
3. When everyone has signed, any party can choose **Apply on Arc**. That party pays the gas.
4. Once it's applied, every party's Obligations page shows the new remaining amounts.

**Dispute an obligation.** On **Obligations**, either party can choose **Dispute** on a signed obligation,
with an optional short reason. A disputed obligation is left out of every loop search and certificate, and a
certificate still collecting signatures that includes it is cancelled. Only the party that raised the dispute
can withdraw it. Contraflow doesn't decide who is right: it keeps the obligation out of netting until you two
sort it out. A dispute can't be raised while the obligation is in a certificate every party has signed.

**Counterparty rules.** On **Obligations**, you can turn on **Only net with approved addresses** and list the
addresses you're willing to net with. Then you're only in loops where every other party is on your list. The
rule is checked when a loop is proposed and again at every signature, for every party in the loop, so a
loop that includes someone a party hasn't approved can't be signed. The loop search then reports that a loop
exists but is blocked by a party's rules, without saying whose.

**Early netting is off by default.** When you record an invoice or an obligation, "Allow this to be netted
before its maturity date" starts unticked, so it can only join a loop after it falls due unless you opt in.

**Before you sign.** The certificate page shows your two obligations with their descriptions, can show
onchain facts about the other parties in the loop, and asks you to confirm you've reviewed your obligations
before the Sign button works. Contraflow checks agreement and arithmetic. It doesn't check that the work
behind an obligation was done.

A certificate has to be fully signed and applied within 7 days.

### Keep and check your certificate

On the certificate's page, choose **Download certificate** to keep your copy. You can check it at
any time on **Verify a certificate**, without signing in. See
[Offchain obligations](offchain-obligations.md) for what the check covers.

## What's still owed

### Quote in EURC

On a settlement receipt or in **Invoice history**, an invoice that still has something owed shows
**Quote in EURC**. It reads the invoice's current remaining amount from Arc and asks Circle Swap Kit
for a USDC to EURC quote, shown with the time it was taken. It's a quote only: nothing is swapped,
and a real swap would be subject to fees and slippage.

### Bring USDC from another chain

From the app's home page, open **Bring USDC from another chain**.

1. **Your balance.** The page shows your Circle Gateway balance per network, including deposits
   still confirming, and the USDC in your wallet on Arc. It's read fresh from Circle every time, so
   you can leave during a deposit and come back.
2. **Deposit.** Choose a network and an amount, review the network fee, and confirm in your wallet.
   Your wallet switches to that network, signs an authorization and sends the deposit. Circle then
   confirms it, which can take several minutes.
3. **Move to Arc.** Once confirmed, choose an amount to move. The review shows Circle's estimated
   fees, which come out of your Gateway balance on top of the amount, so the full amount arrives. Confirm in your wallet; Circle delivers
   the USDC to your own address on Arc, so you don't need gas there.

Every step needs your click and your wallet's signature, and funds only ever go to the address you
signed in with. Wallets that are smart contracts aren't supported yet.

### EURC quote

Below the deposit, move and send tabs, the Balance page has an **EURC quote** card. Type an amount of USDC
(up to 1,000,000) and choose **Get quote** to see what it would be in EURC, from Circle Swap Kit, with the
time it was taken. It's a quote only: nothing is swapped and nothing on the page can start a swap.

## The live demo

The demo runs a whole invoice loop, from signing to settlement, with freshly generated test
parties, so you can see it work without lining up real counterparties first. It always runs on Arc's test network
with test funds, so nothing it does touches real funds, and what it records isn't part of the mainnet figures.

## Send USDC

**Send**, a tab on the Balance page, moves USDC from your wallet on Arc to any address. Enter the amount and the recipient, check the
whole address on the review step, and confirm in your wallet. Your wallet signs the transfer and pays the network
fee, which is a small amount of USDC. Contraflow doesn't see the transfer or hold the funds.

* **Max** sends the most you can while leaving enough for the fee.
* Transfers can't be undone, so check the address. You can't send to the zero address, to your own address, or to
  Contraflow's or USDC's own contract addresses.
* If a send is interrupted, the page asks you to check it before you send again, so it can't be sent twice by mistake.
* If you signed in with email, this is how you move your USDC to a wallet you control elsewhere.
