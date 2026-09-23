# How it works

## The mechanism

1. **Attest.** The debtor and creditor on an invoice each sign an EIP-712 attestation with their
   own wallet — an amount, a maturity date, and whether it can be netted before maturity. Nothing
   is recorded on-chain until both signatures exist.
2. **Register.** Either party submits both signatures to `ContraflowRegistry`. The contract
   verifies both signatures recover to the invoice's own stated debtor/creditor before accepting
   it.
3. **Find a cycle.** A solver looks for closed cycles among registered invoices — A owes B, B
   owes C, C owes A, for example — and computes `W_net`, the largest amount that can cancel across
   every invoice in that cycle at once (the smallest remaining balance on any edge in the cycle).
4. **Settle.** Anyone can submit the resulting cycle to `ContraflowSettler`. It re-checks path
   continuity and amounts, then subtracts `W_net` from every invoice in the cycle in one
   transaction. If any check fails, the entire transaction reverts — nothing half-completes.

That's the product. Gross debt disappears without moving cash, because the debts were already
circular — the transaction just makes that explicit and final on-chain.

## What this does and doesn't prove

An on-chain settlement is a real, verifiable event: three (or more) parties' invoices, cancelled
in place, with the transaction hash to prove it. It is **not** a statutory legal discharge of debt
under any accounting or legal standard — treat it as exactly what it is, a verifiable on-chain
event, not a legal opinion. If your books need a formal netting agreement to recognize a net
position, that's a separate step outside what this protocol does today.

## Trust and disclosure

- **Fails safely.** A missing signature, a broken cycle, or the wrong network — the transaction
  simply doesn't go through. Nothing half-completes.
- **Anyone can settle.** Cancelling a valid, already-attested cycle isn't gated behind the
  operator — anyone can trigger it once it's ready.
- **Upgradeable, and we say so.** The contracts are upgradeable, controlled by a single
  administrative key held by the team — not a multisig or a DAO vote. An upgrade can change how
  the protocol behaves for invoices registered afterward. We disclose that plainly rather than
  claim the contracts can never change.
- **No protocol fee, today.** You pay standard Arc network gas and nothing else. That could change
  in a future version — see the upgrade point above.
- **Address screening is a manual list, not a full compliance integration**, in this phase. Using
  Contraflow is not AML/OFAC clearance.

## Currency and gas

Invoices settle in ERC-20 USDC (6 decimals). Gas on Arc is paid in native USDC (18 decimals) — a
different asset from the invoice currency despite the shared ticker. Any currency conversion for a
leftover balance after a cycle is a separate, explicitly-labeled quote step — never folded into
the cancel transaction itself.
