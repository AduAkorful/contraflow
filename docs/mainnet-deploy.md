# Mainnet deploy checklist

Repo-only runbook for taking Contraflow to Arc mainnet (`5042`). It follows the steps in the order they must
happen; each ends with a check that must pass before the next one. Nothing here is automatic: every step that
spends funds or changes the live site is yours to run.

Stop and ask if any check fails. Don't improvise on mainnet: a deployed proxy can only be changed afterwards by an
upgrade from the owner key.

Conventions: run commands from the repository root unless a `cd` says otherwise. `RPC` is the mainnet RPC you
deploy through (`https://rpc.mainnet.arc.io`, or your keyed provider URL). Never paste a private key into a file
that is committed, a shell history you share, or chat.

---

## 0. Before anything touches mainnet

- [ ] **Commit and push the current code.** Everything built since the plan 55 commits is uncommitted. With
      `NEXT_PUBLIC_ARC_NETWORK` unset the app is still a testnet deployment, so this is safe to ship first.
      Vercel's build for that push must be green, and the testnet site must still work (sign in, the demo, a
      Mode B obligation).
- [ ] **Local suites are green:**
  ```bash
  cd app && pnpm typecheck && pnpm test
  cd ../contracts && forge test
  ```
- [ ] **The database is wiped** (done 2026-10-11, `docs/operations.md` "Data cutover"). If any testnet data was
      written since, run the dry run again and decide.
- [ ] **Supabase Data API is off** (dashboard, Project settings, Data API). The app only uses the connection string.
- [ ] **Keys exist and are backed up.**
  - Mainnet **owner** address (`OWNER_ADDRESS`): holds the upgrade authority. A key you control and have backed up.
  - Mainnet **deployer** (`DEPLOYER_PK`): sends the three deployments. May be the same key as the owner.
  - Mainnet **operator** (`CONTRAFLOW_OPERATOR_PK` in Vercel): sends the starter gas grant. Funded with a small
    amount only; it is the key that holds real funds in the app.
- [ ] **Funding.** The deployments need about 0.3 USDC of native gas at 40 gwei (simulated: 4,173,167 gas for
      Registry plus Settler and 2,528,068 for the ledger; Arc's minimum fee is 20 gwei). Fund the deployer with
      about 1 USDC for margin. Fund the operator with what you are willing to give away as grants (the daily cap
      below limits it).
- [ ] **Privy dashboard:** add **Arc mainnet** as a custom chain (chain ID `5042`, RPC, native currency USDC with
      18 decimals, explorer `https://explorer.arc.io`). Allowed origins don't change.
- [ ] **An RPC key**, if you are using one: the Alchemy Arc mainnet URL for `ARC_RPC`.

Check: `cast chain-id --rpc-url $RPC` prints `5042`, and `cast balance <deployer> --rpc-url $RPC --ether` shows the
funding.

---

## 1. Dry run on mainnet (simulation, free)

```bash
cd contracts
export DEPLOYER_PK=...            # the mainnet deployer key
export OWNER_ADDRESS=0x...        # the mainnet owner
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC
forge script script/DeployNettingLedger.s.sol:DeployNettingLedger --rpc-url $RPC
```

Check: both end with `SIMULATION COMPLETE`, "Chain 5042", and the logged owner is the address you intend. A dry run
writes no record.

---

## 2. Deploy (real funds, irreversible)

```bash
cd contracts
export CONFIRM_MAINNET=true
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast
forge script script/DeployNettingLedger.s.sol:DeployNettingLedger --rpc-url $RPC --broadcast
unset CONFIRM_MAINNET
```

The scripts write `contracts/deployments/mainnet.json` and `mainnet-netting-ledger.json` and refuse to overwrite an
existing record. Each proxy is created and initialised in one transaction.

Check: both finish with `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`.

---

## 3. Read it back from the chain (independent of the script)

```bash
R=<registry proxy>; S=<settler proxy>; L=<ledger proxy>
cast call $R "owner()(address)" --rpc-url $RPC            # your owner
cast call $R "usdc()(address)" --rpc-url $RPC             # 0x3600000000000000000000000000000000000000
cast call $R "settler()(address)" --rpc-url $RPC          # = $S
cast call $S "owner()(address)" --rpc-url $RPC            # your owner
cast call $S "registry()(address)" --rpc-url $RPC         # = $R
cast call $L "owner()(address)" --rpc-url $RPC            # your owner
cast call 0x3600000000000000000000000000000000000000 "decimals()(uint8)" --rpc-url $RPC   # 6
for p in $R $S $L; do cast storage $p 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url $RPC; done
```

Check: every value matches. Each implementation slot equals the implementation address in the JSON record. Also
confirm each implementation's code is this build (equal to the artifact apart from its own embedded address):
`cast code <impl> --rpc-url $RPC` against `jq -r .deployedBytecode.object out/<Contract>.sol/<Contract>.json`.

**If anything is wrong, stop.** Before any use, abandon this deployment and deploy again (record both in the archive).

---

## 4. Verify the source

```bash
cd contracts
for c in "src/ContraflowRegistry.sol:ContraflowRegistry:<registry impl>" \
         "src/ContraflowSettler.sol:ContraflowSettler:<settler impl>" \
         "src/ContraflowNettingLedger.sol:ContraflowNettingLedger:<ledger impl>"; do
  IFS=: read file name addr <<<"$c"
  forge verify-contract "$addr" "$file:$name" --chain 5042 --verifier sourcify
done
```

Blockscout verification for `5042` depends on the mainnet explorer answering automated requests, which it did not
on 2026-10-11 (Cloudflare challenge). If it does by now, repeat with `--verifier blockscout --verifier-url
https://explorer.arc.io/api/ --compiler-version 0.8.36 --num-of-optimizations 200 --evm-version cancun`.

Check: Sourcify reports each as verified.

---

## 5. Record the addresses in the app (never by hand)

```bash
node app/scripts/addresses-from-broadcast.mjs --chain 5042
```

It prints the `ARC_MAINNET_ADDRESSES` entry from Foundry's broadcast files, including the Registry's deployment
block, and the `cast` commands to confirm it. Then in `app/src/contracts/addresses.ts`:

- [ ] paste the entry as `ARC_MAINNET_ADDRESSES`,
- [ ] replace the commented `[ARC_MAINNET_CHAIN_ID]` line in `ADDRESSES_BY_CHAIN_ID` with
      `[ARC_MAINNET_CHAIN_ID]: ARC_MAINNET_ADDRESSES`.

Leave `app/src/blockscout/explorer.ts` alone unless the explorer API answered an automated request live (only the
cycle inspector needs it).

Check:
```bash
cd app && pnpm typecheck && pnpm test
```
Commit `addresses.ts` and the `deployments/mainnet*.json` records, and push. **Don't flip the environment yet:**
this push still builds a testnet site (the variable isn't set).

---

## 6. Flip the site to mainnet

In Vercel (Project settings, Environment Variables, **Production**):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_ARC_NETWORK` | `mainnet` (build-time: needs a redeploy) |
| `CONTRAFLOW_OPERATOR_PK` | the **mainnet** operator key (replaces the testnet one) |
| `ARC_RPC` | your keyed mainnet RPC URL (optional; the public endpoints are the fallback) |
| `DEMO_OPERATOR_PK` | the **testnet** key the demo uses (the old `CONTRAFLOW_OPERATOR_PK`) |
| `STARTER_GAS_GRANT_AMOUNT_USDC` | `0.05` (or your choice) |
| `STARTER_GAS_GRANT_DAILY_CAP_USDC` | the most you will give away per day (default `1`) |
| `CRON_SECRET` | present (used to warm the index) |

Remove or leave `ARC_TESTNET_RPC` as is (the demo uses it). Then **redeploy** (a rebuild is required for the
public variable).

Check, in a browser, signed out:
- [ ] The header network chip reads **Arc**, not Arc Testnet.
- [ ] `/integrations` and the home page's "verify yourself" section list the mainnet Registry, Settler and
      ledger, and the explorer links open `explorer.arc.io`.
- [ ] `/app/demo` still says Arc Testnet and runs (it is testnet-only by design).
- [ ] `/app/api-keys` signed in says live keys are by request.

---

## 7. Warm the chain index and stats

```bash
until curl -s -H "Authorization: Bearer $CRON_SECRET" https://<deployment>/api/cron/stats \
  | grep -Eq '"index":(null|\{[^}]*"caughtUp":true)'; do sleep 1; done
```

On a fresh mainnet deployment the deployment block is at the head, so this is a handful of calls.

Check: the home page "Live on Arc" strip shows figures (zeros are fine before activity, but never an error), and
it says Arc, not Arc testnet.

---

## 8. Run the acceptance walk (spec §11) with real wallets

Three wallets you control, A, B and C, each with a little USDC for gas (or sign in fresh to receive the starter
grant). Write down every transaction hash.

Before you start, note each wallet's USDC balance:
```bash
for w in A B C; do cast call 0x3600000000000000000000000000000000000000 "balanceOf(address)(uint256)" $w --rpc-url $RPC; done
```

1. **Three invoices forming a cycle** (A owes B, B owes C, C owes A), each signed by both parties and registered
   from the app. Check each is visible on `explorer.arc.io` (open it in a browser).
2. **Settle.** From the app, settle the loop. Then:
   - each invoice's remaining decreased by `wNet`: `cast call $R "getInvoice(bytes32)((address,uint64,bool,uint8,address,uint256,uint256))" <id> --rpc-url $RPC`
     (the sixth field is `amountRemaining`),
   - the three wallets' USDC balances are **unchanged** (only native gas moved on the sender).
3. **A second settle with a `wNet` above remaining reverts.** Simulate it:
   ```bash
   cast call $S "settle(bytes32[],uint256)" "[<id0>,<id1>,<id2>]" <wNet larger than remaining> --from <any address> --rpc-url $RPC
   ```
   Expect a revert (`AmountExceedsRemaining` or `InvoiceNotActive`).
4. **A broken path reverts.** Simulate with the ids in an order that doesn't close:
   ```bash
   cast call $S "settle(bytes32[],uint256)" "[<id0>,<id2>,<id1>]" 1 --from <any address> --rpc-url $RPC
   ```
   Expect `PathBroken(<index>)`.
5. **The receipt page** `/app/receipt/<settle tx hash>` shows the hash and the "$0 cash moved" line.
6. **Copy check.** Nothing says "legally extinguished", "zero-spread", "MEV-proof" or "validator OFAC".

Also walk the Mode B path once (an obligation, a certificate, apply, then `/app/verify`), and check a first-time
sign-in shows the starter-grant notice and that the operator balance dropped by about the grant amount.

Record the transaction hashes and the `cast` outputs in `plans/session-log-archive.md`.

---

## 9. Documentation, README and submission

- [ ] **README** (spec §11 item 6): chain ID `5042`, the three contract addresses, the ERC-20 USDC address
      (`0x3600000000000000000000000000000000000000`), how to fund gas (USDC is the gas token), that `settle()` is
      permissionless, that Swap Kit is quote-only. Link the reference docs. No "hackathon", no "open source".
- [ ] **GitBook** pages that name addresses, gas, chain ID and API keys: update from this deployment and publish.
- [ ] **Repository visibility** matches what you intend for the submission (the licence stays BUSL-1.1 and
      proprietary: source-available, never "open source").
- [ ] **Submit** on DoraHacks (closes 14 Oct 2026 23:59 ET) only after every item in section 8 passes on mainnet.

---

## If something goes wrong after the flip

| Situation | Action |
|---|---|
| The site misbehaves but contracts are fine | Redeploy the previous commit, or unset `NEXT_PUBLIC_ARC_NETWORK` and redeploy to return to testnet. Mainnet contracts are unaffected |
| A contract defect found after real use | An upgrade from the owner key (UUPS). Rehearse it on testnet first |
| Starter-grant funds draining | Lower `STARTER_GAS_GRANT_DAILY_CAP_USDC` (and redeploy), or set the amount to a value the cap makes zero |
| Stats or the chain index stuck | Call the warm loop in section 7; an index lost from Redis rebuilds from the deployment block |
| An RPC provider rate limits | The server falls back to Arc's public endpoints; check `ARC_RPC` and the provider's dashboard |
