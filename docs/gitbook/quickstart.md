# Quick start: a three-company loop in ten minutes

This script runs a complete loop on the network your key belongs to: three companies, three obligations in a circle, a netting certificate that every company signs, and the apply transaction. When it finishes you have an applied certificate you can verify.

You need:

* **An API key.** Sign in at the app, open **API keys**, and create one. On Contraflow's Arc mainnet deployment that is a live key (`cfk_live_…`). A test key (`cfk_test_…`) runs the same script on Arc testnet.
* **A payer wallet** holding a little USDC on the key's network, about 0.005 USDC for gas. This is the only wallet that pays; the three companies only sign, so they need no funds. On mainnet this is real USDC, and the applied certificate is a real onchain event that appears in the public totals. For testnet USDC, use Circle's faucet at `faucet.circle.com` (choose Arc Testnet).
* **Node 20 or later** and `viem`.

## Run it

```bash
mkdir contraflow-sandbox && cd contraflow-sandbox
npm init -y
npm install viem
curl -O https://contraflow.vercel.app/contraflow-quickstart.mjs
CONTRAFLOW_API_KEY=cfk_live_... PAYER_PRIVATE_KEY=0x... node contraflow-quickstart.mjs
```

Use environment variables for both keys, as above, and never commit them.

## What it does

1. Creates three company wallets and has each grant your key a signed permission (read, propose and deliver signatures, for an hour).
2. Records three obligations in a circle: Atlas owes Meridian 1,000, Meridian owes Northwind 800, Northwind owes Atlas 600. For each, the debtor proposes and signs, and the creditor accepts and signs.
3. Finds the loop through Atlas. The amount netted is the smallest obligation in the loop, 600.
4. Collects each company's signature on the certificate.
5. Fetches the apply transaction and sends it from the payer wallet, then reports the hash.
6. Reads all three obligations back, one per company: the 600 is netted off each, so they show 400, 200 and 0 remaining, and the third is `closed`.

No USDC moves between the companies. The only transfer is the gas the payer pays.

## Where to go next

The script is a working integration to copy from. The steps map one to one onto the [API reference](reference/api.md). In your own system the three wallets become your customers' own keys or custody, and an email-only company applies from the app or uses a payer wallet you control (see "Who pays the gas"). To be told when a certificate is applied, register an endpoint (`POST /webhooks/endpoint`) and update your books from `certificate.applied`.

If you are building with an AI agent, give it [the agent brief](api-agents.md) as well.
