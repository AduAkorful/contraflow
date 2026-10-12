# Contraflow

Contraflow cancels circular accounts payable on Arc. When company A owes B, B owes C and C owes A, the three debts net against each other in one transaction: every invoice in the loop is reduced by the same amount, and no USDC moves between the parties. The only thing that costs anything is gas.

- **App:** https://contraflow.vercel.app
- **Docs:** https://aduakorful.gitbook.io/contraflow-docs
- **Network:** Arc mainnet, chain ID `5042`

## What it does

1. **Two parties attest an invoice.** The debtor and the creditor each sign the same EIP-712 invoice. One of them registers it onchain, and the Registry checks both signatures.
2. **A loop is found.** Contraflow looks for closed loops of three to five registered invoices and works out the largest amount that can come off every invoice in the loop.
3. **Anyone settles it.** `settle(ids, wNet)` is permissionless. It checks that the invoices really form a loop and that `wNet` fits each one, then reduces them all in one transaction. If anything is wrong, the whole transaction reverts.
4. **The receipt shows what happened.** The settlement transaction hash, each invoice before, netted and remaining, and the USDC that moved between the parties: zero.

For debts in any currency, offchain obligations can be signed by both parties and netted with a certificate every party in the loop signs. Only commitments go onchain, so amounts stay with the parties. See the docs for how it works and for the API.

## What it uses Arc for

- **USDC is the gas token**, so a settlement costs under a cent and nobody holds a volatile token to use it.
- **Sub-second finality** makes a multi-party cancel one block, not a sequence of transfers to wait on.
- **Invoices are in USDC.** The Registry accepts ERC-20 USDC invoices only, so the same dollar token pays for gas and denominates the debt.
- **Swap Kit is quote-only.** The app can show what a remaining balance would be worth in EURC through Circle's Swap Kit. Nothing is swapped, and no kit is ever called from the contracts.

## Contracts on Arc mainnet (`5042`)

The three contracts sit behind ERC-1967 proxies. These are the proxy addresses.

| Contract | Address |
|---|---|
| `ContraflowRegistry` | [`0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312`](https://explorer.arc.io/address/0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312) |
| `ContraflowSettler` | [`0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03`](https://explorer.arc.io/address/0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03) |
| `ContraflowNettingLedger` | [`0xCf7759128399ACF6f69dd76c852074ed9050fc28`](https://explorer.arc.io/address/0xCf7759128399ACF6f69dd76c852074ed9050fc28) |
| USDC (ERC-20, 6 decimals) | [`0x3600000000000000000000000000000000000000`](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) |

The implementations are verified on Sourcify. Deployment records are in [`contracts/deployments/`](contracts/deployments), and the app reads the same addresses from [`app/src/contracts/addresses.ts`](app/src/contracts/addresses.ts).

- **`ContraflowRegistry`** stores signed USDC invoices and is the only place an invoice's remaining amount can change.
- **`ContraflowSettler`** checks a loop and reduces every invoice in it by the same amount, in one transaction.
- **`ContraflowNettingLedger`** records a blinded state for each offchain obligation, advanced only by a certificate every party in the loop signed.

None of them holds funds or calls a token contract. Protocol fee: none.

## Funding gas

Gas on Arc is paid in native USDC, and there is no mainnet faucet.

- **A new account** that signs in to the app receives a small one-time amount of USDC to cover its first network fees, subject to a daily cap.
- **Otherwise,** bring USDC to Arc from another chain with Circle's Gateway or CCTP, or send it from another Arc wallet. A settlement costs about 0.002 to 0.005 USDC.

## Trust, in short

- `settle()` is permissionless: anyone can submit a valid, fully signed loop. Contraflow never sends it for you.
- Contraflow never signs for anyone. A debt changes only with the signatures of the parties it affects.
- Netting records what the parties have signed. It does not by itself discharge a debt under any legal or accounting standard, and Contraflow is not connected to anyone's bank account or to the asset behind a debt.
- The contracts are upgradeable behind a single operator key. The docs' trust and security section and the terms describe what that means.

## Repository

| Path | What is there |
|---|---|
| `contracts/` | Solidity 0.8.36, Foundry. Registry, Settler, Netting Ledger, deploy scripts, tests. |
| `app/` | The Next.js app and the public API (`/api/v1`, OpenAPI at `/api/v1/openapi.json`). |
| `packages/solver/` | Loop search over the invoice graph. |
| `docs/gitbook/` | The documentation published to GitBook. |

### Run the tests

```bash
cd contracts && forge test            # contracts
pnpm install && pnpm --filter @contraflow/solver test
cd app && pnpm typecheck && pnpm test # app (a few tests call live services)
```

The app needs its environment variables for anything beyond the tests; see [`app/.env.example`](app/.env.example).

## License

This repository is public for viewing and audit purposes — it is **not open source**. See [LICENSE](LICENSE) for full terms.

- `contracts/` is licensed under the [Business Source License 1.1](contracts/LICENSE) — publicly viewable, not licensed for production use, converting to MIT on 2030-09-22.
- Everything else in this repository is proprietary — all rights reserved, no license granted to use, copy, modify, or redistribute.
