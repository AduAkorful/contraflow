# Arc Microgrants — overview and Contraflow requirements

**Program:** [Arc Microgrants](https://dorahacks.io/hackathon/arc-microgrants/detail) (Circle / Arc, hosted on DoraHacks)  
**Product we submit:** Contraflow  
**This file:** hackathon rails. Strategy lives in [`contraflow-spec.md`](./contraflow-spec.md). If they conflict, **stop and ask**.

Last checked against the listing: **17 Sep 2026**. Re-read the DoraHacks page before submit; dates and grant counts may change.

---

## 1. What this program is

Not a weekend hackathon with tracks and a demo day. Circle is seeding the first wave of **live Arc mainnet** apps with twenty equal microgrants.

| | |
|---|---|
| Pool | 10,000 USDC |
| Awards | **20 × 500 USDC** on Arc, non-dilutive |
| Format | Virtual, rolling review |
| Close | **14 Oct 2026, 23:59 ET** |
| Decisions | Rolling; **all out by 21 Oct 2026** |
| Ownership | Builder keeps IP. No equity, assignment, or exclusivity |

You **build first, then submit**. One live mainnet link, a public repo, a short Arc-specific description, a public profile (GitHub, X, or Farcaster). No company, deck, or traction required.

**Promise counts for more than traction.** The $500 is a ticket into Circle office hours / intros / the [Circle Grant Program](https://www.circle.com/grant), not the real prize.

---

## 2. Hard eligibility (fail = reject at screen)

Must be true **at the moment of submit**:

1. **Deployed and working on Arc mainnet** (chain ID `5042`). Testnet-only is ineligible.
2. A link the reviewer can **open** (live deployment).
3. A **public repo**.
4. Short description of what it does **and what it uses Arc for**.
5. Public builder profile.
6. Work is ours (or we have the right to submit).
7. Not already funded by a Circle or Arc program.
8. Wallet that can receive USDC on Arc (payout).

Not eligible: mockups, slide decks, testnet-only, no Arc component, prior Circle/Arc-funded work.

Open worldwide subject to sanctions / restricted-jurisdiction screening. Pseudonymous until payout; verification is private and only for winners.

**Gas:** Arc uses USDC as gas. Need a small amount of **real mainnet USDC** to deploy and transact. There is no mainnet faucet.

---

## 3. How they score

No published weights. From the listing:

| Criterion | What Contraflow must show |
|---|---|
| **Relevance to Arc** | USDC gas, dollar fees, sub-second finality, in-place netting that would be painful on volatile-gas EVMs. Optional `estimateSwap` quote panel (not a fill). |
| **Technical credibility** | Contracts on explorer, README with chain ID / addresses / how to try, public repo. |
| **Quality of what you built** | A stranger completes the 3-node cancel in a few minutes. Small finished thing, not a large unfinished stack. |
| **Worth taking further** | Four-sentence Circle Grant sequel in the README. Not a 12-month roadmap as the demo. |

**Do not claim on the listing or UI:** legally extinguished debt, zero-spread FX, MEV-proof, validator OFAC, atomic Swap/Gateway inside `settle()`, live industrial volume.

---

## 4. What Contraflow submits (Phase 1)

Defined in the spec. Hackathon-complete means all of these:

| Artifact | Requirement |
|---|---|
| `ContraflowRegistry` | EIP-712 bilateral invoices, USDC-only, on mainnet `5042` |
| `ContraflowSettler` | Permissionless `settle()`; 3–5 node cycle; in-place subtract `W_net`; full revert; **$0 protocol fee** |
| Fixture | Northwind DSP → Meridian Exchange → Atlas Publisher; `earlyNetConsent = true` |
| Next.js radar | Graph, `$0` cash moved, explorer link, live tiles from chain |
| Quote panel | `kit.estimateSwap` USDC→EURC, **labeled quote-only** |
| README | Chain ID, addresses, ERC-20 USDC, how to fund gas, `settle()` is permissionless, Swap is not executed |

Acceptance tests: spec §11. If a test is not green on **mainnet**, we do not submit.

---

## 5. Network parameters (confirm at deploy)

| | Mainnet (submit here) | Testnet (rehearsal only) |
|---|---|---|
| Chain ID | `5042` | `5042002` |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://testnet.arcscan.app` |
| Native gas USDC | 18 decimals | same model |
| ERC-20 USDC | `0x3600000000000000000000000000000000000000` (6 decimals) | same address on testnet |

Invoice amounts use **6-decimal ERC-20 USDC**. Gas uses **18-decimal native USDC**.

Official docs still lean testnet for App Kit samples (`Arc_Testnet`). Confirm the mainnet chain enum (`Arc` vs `Arc_Mainnet`) against the SDK at implement time.

---

## 6. Timeline

Today is **17 Sep 2026**. Mainnet opened **16 Sep**. Submissions close **14 Oct 23:59 ET** (~27 days). Rolling review: **earlier complete packets get earlier answers**.

| Window | Work | Do not |
|---|---|---|
| Week 1 | Architecture + step plans accepted. Registry + Settler + tests on testnet rehearsal, then **mainnet deploy**. | App Kits inside Solidity. Earn. Upgradeable proxies. |
| Week 2 | Fixture solver + Next.js radar on the live contracts. | Fake dashboard KPIs from the v2 mock. |
| Week 3 | `estimateSwap` panel. README. Record a 2-minute path. **Submit as soon as §11 passes** — do not wait for 14 Oct. | Scope creep (Gateway spend, DCW, EURC invoices, ERP). |

If the live link works in week 2, submit in week 2.

---

## 7. Listing copy (draft)

**What it does:** Contraflow cancels circular accounts payable on Arc. Three parties attest invoices; one transaction subtracts the bottleneck amount from every invoice in the cycle. Gross debt disappears; no USDC moves except gas.

**What it uses Arc for:** Native USDC gas (dollar OpEx, no volatile token), deterministic sub-second finality for a multi-party cancel in one block, optional Swap Kit **quote** to show the EURC corridor without breaking atomicity.

**Next:** Circle Grant path is sequenced orchestration (Swap fill, Gateway residual) on top of this atomic core — not inside it.

---

## 8. Sources

- [Arc Microgrants detail](https://dorahacks.io/hackathon/arc-microgrants/detail)
- [Circle Arc mainnet launch](https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet) (16 Sep 2026)
- [Circle Developer Grants](https://www.circle.com/grant)
- [Arc docs](https://docs.arc.io/) · [App Kits](https://docs.arc.io/app-kit) · [Gas and fees](https://docs.arc.io/arc/references/gas-and-fees)
