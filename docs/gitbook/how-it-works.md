# How it works

Contraflow nets loops of debt. When A owes B, B owes C and C owes A, every debt in the loop can
be reduced by the same amount, the smallest of them, without any money moving. Contraflow finds
those loops and nets them in one step.

## Invoices on Arc

1. **Sign.** The debtor and creditor each sign the invoice with their own wallet: the amount in
   USDC, a maturity date, and whether it can be netted before maturity.
2. **Register.** Either party submits both signatures to Contraflow's invoice registry on Arc,
   which checks that each signature belongs to the party it names.
3. **Find a loop.** Contraflow looks for closed loops of three to five invoices among registered
   invoices and works out the largest amount that can come off every invoice in the loop.
4. **Settle.** Anyone can submit the loop to Contraflow's settler. It checks that the invoices
   really form a loop and that the amount fits every one of them, then reduces them all in a
   single transaction. If any check fails, nothing changes.

No USDC moves during settlement: balances are reduced in place, and the only cost is gas.

## Offchain obligations

1. **Sign.** Both parties sign an obligation in any currency. Nothing goes onchain.
2. **Find a loop.** Contraflow looks for closed loops of two to five obligations in the same
   currency.
3. **Certify.** Contraflow proposes a netting certificate for the loop. Each party reviews only
   their own obligations and the amount being netted, then signs.
4. **Apply.** Anyone can apply the signed certificate to Contraflow's netting ledger on Arc. The
   ledger checks every signature and that each obligation is still in the state the certificate
   was built on, then records each obligation's new, blinded state.

Because each certificate has to start from an obligation's current recorded state, the same debt
can't be netted twice. See [Offchain obligations](offchain-obligations.md) for the details.

## Trust and security

This is the one place these docs set out what you're trusting when you use Contraflow.

- **What a settlement or certificate is.** It's a record the parties signed and the contracts
  applied: evidence of what they agreed to net. It works alongside your own agreements with your
  counterparties, not in place of them, and doesn't by itself discharge a debt under any legal or
  accounting standard.
- **What is and isn't checked.** Contraflow checks that every party agreed: each obligation carries
  both parties' signatures, a loop needs every party's signature, and the amounts can't exceed what
  is still owed. It does not check that the goods or services behind an obligation were delivered.
  A party who thinks an obligation is wrong can dispute it: it is then left out of every loop until
  the dispute is withdrawn, and Contraflow doesn't decide who is right.
- **What Contraflow isn't connected to.** Contraflow doesn't connect to your bank accounts or treasury, or to
  the asset or receivable behind a debt, and it holds no funds for anyone. Netting changes what the parties have
  signed as owed; it doesn't change a balance anywhere else. Paying what's left, and keeping your own books in
  step, stays with you. See the [Roadmap](roadmap.md) for what isn't available yet.
- **Nothing half-completes.** A missing signature, a broken loop or the wrong network means the
  transaction doesn't go through at all.
- **Anyone can settle.** Settling a valid loop or applying a signed certificate isn't gated
  behind Contraflow.
- **Upgradeable contracts.** The registry, settler and netting ledger are upgradeable, controlled
  by a single administrative key held by the team, not a multisig or a governance vote. An
  upgrade can change how the protocol behaves from that point on.
- **What Contraflow can see.** Contraflow stores the obligations you submit, and can read them;
  it needs them to find loops. It holds no one's keys, so it can't sign a certificate for you,
  and the ledger stops it netting anything twice.
- **Platforms act only with your permission.** A platform using the Contraflow API can act for you only
  after you sign a permission for it, which is limited in scope and expires within a year. It can see and
  propose within that permission, but it can't sign for you: every obligation and certificate still needs your
  own signature.
- **What's public.** For invoices, the parties, amounts and terms are public on Arc. For
  obligations, amounts, currency and descriptions never go onchain, but the addresses in each
  certificate and the shape of the loop are public, so participation isn't anonymous. Each
  obligation's terms are shown only to its two parties; everyone in a loop sees the addresses in it.
- **Fees.** There's no protocol fee today. You pay Arc network gas and nothing else. That could
  change in a future version, through an upgrade.
- **Address screening.** Contraflow screens addresses against a list it maintains. That isn't
  anti-money-laundering or sanctions clearance, and Arc's validators don't screen transactions on
  Contraflow's behalf.
- **Quotes and moving USDC.** A EURC quote is Circle Swap Kit's estimate at the time shown; Contraflow
  doesn't execute swaps. Bringing USDC from another chain happens between your own wallet and Circle
  Gateway: Contraflow never holds, routes or signs for those funds, they only ever go to your own address,
  and Circle's fees apply.
- **Audits.** The contracts haven't been through a formal third-party audit. Their source is
  published and verified on Sourcify, and every transaction is on the Arc explorer.

## Currency and gas

Invoices settle in USDC on Arc. Gas on Arc is paid in native USDC, which is a separate balance
from the USDC your invoices are in, even though they share a name. Obligations can be in any
currency, and a certificate only ever nets obligations in the same currency.

## What's still owed

Netting reduces every invoice in a loop by the same amount, so some invoices keep a remaining balance.
Where the app shows one, **Quote in EURC** gets a live Circle Swap Kit quote for that amount. It's a
quote only: nothing is swapped.

To pay what you owe on Arc, you need USDC in your wallet there. **Bring USDC from another chain**
deposits USDC from your wallet on another network into Circle Gateway, then moves it to your own
wallet on Arc. You don't need gas on Arc for the move, and Circle's fees are shown before you sign.

Contraflow doesn't pay the remainder for you. See the [Roadmap](roadmap.md).

## Protocol stats

The stats on the home page are counted from the contracts' own events, read directly from Arc. They
aren't estimates, and nothing is entered by hand. The page asks again every 30 seconds while it's open.

* **Invoices registered** counts every invoice registered with the Registry.
* **Value netted** is the total each settlement reduced USDC invoice balances by, summed across every
  invoice in the loop.
* **Loops settled** counts invoice loops settled through the Settler, plus netting certificates applied to
  the Netting Ledger. Settlement reduces balances in place, so no tokens move and the only cost is gas.
* **Face value registered**, **Invoices fully netted** and **Parties** (distinct invoice debtors and creditors)
  are shown in the detail below the headline figures.
* **Obligation updates** counts offchain obligation changes. Their amounts never go onchain, so they can't be
  totalled and they aren't in value netted.
* **Every event counts**, whoever sent it, including Contraflow's own test runs, so anyone can recount the
  figures from the chain.

Every figure carries an "as of" time and names the network it's counted on. While the full history is still
being read, the page says it's still counting and that the figures are incomplete, instead of presenting a
partial count as exact.
