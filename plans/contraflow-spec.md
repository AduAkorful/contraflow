# Product Requirements Document (PRD): Contraflow

**One-liner:** Contraflow on Arc — cancel circular A/P so invoices die and no USDC moves.

**Document Version:** 3.2.0  
**Status:** Phase 1 PoC — ready to build for Arc Microgrants  
**Supersedes:** 3.1.0  
**Target Environment:** Arc public mainnet (L1)  
**Primary settlement asset (Phase 1):** ERC-20 USDC on Arc  
**Gas asset:** Native USDC on Arc (18 decimals)  
**Orchestration (Phase 2+):** `@circle-fin/app-kit` (Swap, Unified Balance, Bridge), Circle Developer-Controlled Wallets, Circle Gateway / CCTP  
**Earn Kit:** out of product scope until custody UX is designed separately  

---

## Document history

| Version | Date | Change |
| :--- | :--- | :--- |
| 2.0.0 | — | Institutional draft. Treated App Kits as on-chain atomic calls, claimed validator AML precompiles, statutory IFRS extinguishment, and zero-spread FX. |
| **3.0.0** | 17 Sep 2026 | Rewrite after API and architecture review. Atomic core is same-asset in-place netting only. App Kits, Gateway, and compliance are sequenced off-chain. Legal netting is Phase 3. |
| **3.1.0** | 17 Sep 2026 | Owner decisions: early-net consent; permissionless `settle()`; ads-themed fixture (DSP / Exchange / Publisher); protocol fee $0; `estimateSwap` quote panel in P1; Earn dropped from the product story. |
| **3.2.0** | 17 Sep 2026 | Product renamed from ArcNet to **Contraflow**. Contracts: `ContraflowRegistry`, `ContraflowSettler`. Arc remains the chain, not the brand. |

**How to read this document**

- **Phase 1** is the only committed build: two contracts, an operator solver, a live mainnet 3-node demo.
- **Phase 2 / 3** are labeled target-state. They are not acceptance criteria for the Microgrant.
- Circle App Kit methods (`kit.swap`, `kit.unifiedBalance.*`, `kit.bridge`) run in TypeScript against wallet adapters. They are **not** callable from Solidity and do **not** share a revert boundary with `ContraflowSettler`.

---

## 1. Executive summary and problem

### 1.1 Executive summary

**Contraflow** is a multilateral A/P–A/R netting protocol on Arc. Counterparties attest invoices on-chain. An off-chain solver finds circular obligation cycles. A settlement contract cancels the bottleneck amount on every invoice in that cycle in **one Arc transaction**. Gross debt disappears without moving cash.

That is the product. Everything else (FX, cross-chain residuals, ERP, legal netting) is orchestration or commercial follow-on. Yield vaults are explicitly out of scope.

Arc is the right chain for this because gas is USDC, fees are dollar-denominated, and finality is deterministic and sub-second. Treasurers do not have to hold a volatile gas token to clear commercial debt.

Phase 1 exists to prove the atomic core on Arc mainnet for [Arc Microgrants](https://dorahacks.io/hackathon/arc-microgrants/detail): a reviewer opens a live link, sees three attested invoices, one `settle()` transaction, and $0 cash moved.

### 1.2 The industrial problem

B2B settlement is still bilateral:

* **Working-capital trap.** A DSP owes an ad exchange $100k, the exchange owes a publisher $100k, the publisher owes the DSP $100k (data / make-good / contra). **$300,000** sits immobilized across three balance sheets. Net economic transfer required: **$0.00**.
* **Cross-currency friction.** Transatlantic invoices in USD and EUR still clear through correspondent banks, 1.5–3% FX spreads, and multi-day lags. Stablecoin FX on Arc is cheaper and faster; it is **not** zero-spread (see §6 Swap Kit).
* **Treasury fragmentation.** Cash sits on Ethereum, Base, Solana, Arbitrum, and bank accounts. Getting it onto Arc to pay a residual is an extra operational step (Gateway deposit, then spend — see §6 Unified Balance).
* **Idle float.** Net-30 / Net-60 cash sitting uninvested is a real cost. Contraflow’s answer is **not to move that cash at all** when a cycle exists. Parking it in a yield vault would re-lock working capital; Earn is out of product scope.
* **Volatile gas.** ERP and treasury desks cannot hold ETH/SOL as an operating expense without GAAP/IFRS mark-to-market noise. Arc gas in USDC removes that objection. It does **not** by itself make on-chain cancel statutory debt extinguishment (see §8.3).

> **Architectural resolution (accurate):**  
> Contraflow models attested invoices as a directed graph. The operator solver finds closed cycles off-chain and optionally screens addresses via application-layer compliance APIs. Anyone may submit a valid `settle()`; the contract is the authority. `ContraflowSettler` verifies path continuity and amounts, then subtracts `W_net` from each invoice in one transaction. If any check fails, the **entire cancel reverts**. FX conversion and Gateway residuals — if used later — run as **separate, subsequent** App Kit operations with their own success/fail handling.

### 1.3 What Phase 1 will and will not claim

| We will claim | We will not claim |
| :--- | :--- |
| Live Arc mainnet deployment a reviewer can open. | Atomic FX or cross-chain spend inside the cancel transaction. |
| Three (or more) bilateral invoices cancelled in place with $0 USDC transferred. | Statutory IFRS 9 / ASC 405-20 derecognition. |
| Explorer tx + public repo + EIP-712 attestations. | Consensus-level AML / OFAC at the validator. |
| Dollar-denominated gas on Arc. | Zero-spread USDC⇄EURC. |
| A labeled roadmap into Circle Grants. | Live industrial volume or the dashboard’s sample KPI figures. |

---

## 2. Personas, verticals, and Phase 1 beachhead

### 2.1 Personas

| Persona | Role | Phase 1 | Later |
| :--- | :--- | :--- | :--- |
| **Demo operator / reviewer** | DoraHacks / Circle evaluator | Primary user of the live PoC. | — |
| **Corporate treasurer** | Working-capital owner | Narrative audience. Not a login in Phase 1. | Unified Balance view, residual settlement, policy console. |
| **Supply-chain / trade CFO** | Multi-tier payables | Narrative. | Consortium onboarding, EURC corridor. |
| **B2B invoicing / ERP operator** | Actual distribution channel | Out of scope. | Headless clearing via Developer-Controlled Wallets. **Policies are enforced in Contraflow’s application layer**, not by a built-in Circle policy engine ([Circle DCW docs](https://developers.circle.com/wallets/dev-controlled)). |
| **Chief compliance officer** | Sanctions / AML | Out of scope for the demo graph. | Pre-insert address screening via Circle Compliance Engine and/or Chainalysis, Elliptic, TRM Labs APIs ([Arc compliance vendors](https://docs.arc.io/arc/tools/compliance-vendors)). |

### 2.2 Target verticals

* **Phase 1 fixture (programmatic advertising).** Three synthetic parties on Net-60 media terms:
  * **Northwind DSP** owes **Meridian Exchange** (cleared impressions).
  * **Meridian Exchange** owes **Atlas Publisher** (supply payout).
  * **Atlas Publisher** owes **Northwind DSP** (audience / data / make-good contra).
  Same $W$ on each edge so a reviewer sees a perfect $0-cash cycle. Copy and legal names are fixture-only — not a live consortium.
* **Later commercial:** transatlantic automotive / aerospace (needs EURC + legal netting) and maritime / freight. Not in the Microgrant build.

### 2.3 Distribution thesis

Netting has a network effect: it only pays when a closed set of counterparties all join. Contraflow does not acquire Global 2000 treasurers from a Next.js dashboard. The durable channel is an **invoicing or ERP operator** who already has the graph. Phase 1 exists to give Circle a working primitive those operators can later embed.

---

## 3. System architecture

### 3.1 Layers and trust boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. INGESTION                                                                │
│    CSV / fixture UI / (later) invoicing API                                 │
│    Debtor + creditor each sign EIP-712 InvoiceAttestation                   │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. APPLICATION LAYER  (trusted operator in Phase 1)                         │
│    • Optional address screen (Compliance Engine / vendor API)               │
│    • Directed graph G = (V, E), edge = remaining USDC obligation            │
│    • Cycle finder (Tarjan SCC + bounded Johnson enumeration)                │
│    • Build SettleCall { invoiceIds[], W_net }                               │
│    • Propose SettleCall { invoiceIds[], W_net }; anyone may submit it       │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │  one Arc tx
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. ATOMIC SETTLEMENT  (Arc L1 — the only revert boundary)                   │
│    ContraflowRegistry.sol   canonical invoice state                             │
│    ContraflowSettler.sol    path check + subtract W_net from every invoice      │
│    Gas paid in native USDC                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Phase 2+ (NOT inside the settler, NOT the same revert boundary)
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. ORCHESTRATION  @circle-fin/app-kit                                       │
│    kit.estimateSwap / kit.swap     USDC⇄EURC after or beside netting        │
│    kit.unifiedBalance.deposit/spend  residuals, requires prior Gateway dep. │
│    kit.bridge                        CCTP move onto Arc if Gateway unused   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 On-chain contracts (Phase 1)

**`ContraflowRegistry`**

* Stores invoices: `id`, `debtor`, `creditor`, `amountRemaining` (6-decimal USDC), `maturity`, `earlyNetConsent` (bool, covered by both EIP-712 signatures), `attestationHash`, `nonce`, `status`.
* `register(InvoiceAttestation debtorSig, InvoiceAttestation creditorSig)` — both EIP-712 signatures required; amounts and parties must match; nonce strictly increasing per `(debtor, creditor)` pair.
* No custody. No token transfer on register.

**`ContraflowSettler`**

* `settle(bytes32[] invoiceIds, uint256 wNet)` 
  * `invoiceIds.length` in `[3, 5]` for Phase 1 (hard cap; raise later).
  * Invoices form a simple directed cycle: `creditor[i] == debtor[i+1]`, last wraps to first.
  * Each `amountRemaining >= wNet`.
  * Each invoice `status == Active`.
  * Each invoice is nettable: `block.timestamp >= maturity` **or** `earlyNetConsent == true` (both parties signed that flag in the attestation).
  * Subtracts `wNet` from each; if `amountRemaining` hits 0, status → `ExtinguishedOnchain` (this is **protocol** state, not legal extinguishment).
  * Reverts entirely on any failed check. No partial cancel.
  * **No `msg.sender` restriction.** If the cycle checks pass, anyone may call `settle()`. The demo UI still uses an operator wallet so a reviewer clicks one button.
  * **No protocol fee.** `wNet` is cancelled in full; no USDC transfer.

No contract in Phase 1 calls Swap, Gateway, Bridge, or Earn. Contracts are **non-upgradeable**.

### 3.3 Off-chain solver (Phase 1)

* Operator-hosted service. **The operator is trusted to propose** which cycle to highlight when many exist. Submission of `settle()` is permissionless; on-chain checks prevent invalid cancels. They do not prevent unfair *proposal* order in the UI.
* Algorithm: Tarjan SCC to drop acyclic components, then Johnson enumeration with **hard caps**: `|V| ≤ 32`, cycle length `K ∈ [3, 5]`, max cycles returned `100`. First valid cycle with maximum `W_net` is submitted. No 500 ms SLA until measured.
* `W_net = min_i amountRemaining(e_i)` over the chosen cycle. Phase 1 edges are USDC-only; no FX normalization in the settler.

### 3.4 Network parameters

Confirm against [Arc docs](https://docs.arc.io/) at deploy time. Values as of 16–17 Sep 2026:

| Parameter | Mainnet | Testnet (rehearsal only) |
| :--- | :--- | :--- |
| Chain ID | `5042` (`0x13b2`) | `5042002` |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://testnet.arcscan.app` |
| Native gas token | USDC, **18 decimals** | same model |
| ERC-20 USDC | `0x3600000000000000000000000000000000000000` (**6 decimals**) | same address on testnet |
| ERC-20 EURC (Phase 2) | `0xbEf5f6d51CB62b58e6A8F77868681825C6fe21c1` (6 decimals) | different testnet address |
| Finality | Deterministic, sub-second | same |
| App Kit chain id | Confirm SDK enum at implement (`Arc` vs `Arc_Mainnet`). Docs samples still show `Arc_Testnet`. | `Arc_Testnet` |

**Decimal rule:** invoice `amountRemaining` uses the **6-decimal ERC-20 USDC** interface. Gas accounting uses **18-decimal native USDC**. These share one underlying balance; wallets may display native as “ETH” or scaled 10^12 too large. Phase 1 UI always shows 6-decimal USDC for invoices and a separate gas-fee line in dollars.

**Do not submit the Microgrant against testnet.** The program requires a live Arc mainnet link.

---

## 4. Functional requirements

Each requirement is tagged **P1** (Microgrant), **P2** (Circle Grant / pilot), or **P3** (institutional).

### 4.1 Invoice ingestion and attestation

* **FR-1.1 (P1) Bilateral attestation.** EIP-712 typed data `InvoiceAttestation`: `invoiceRef` (bytes32), `amount` (uint256, 6-decimal USDC), `currency` (address, must equal Arc ERC-20 USDC in P1), `maturity` (uint64 unix), `earlyNetConsent` (bool), `debtor` (address), `creditor` (address), `nonce` (uint256), `registry` (address), `chainId` (uint256). Both parties sign the same payload. Domain separator binds to `ContraflowRegistry` and chain ID `5042`. Fixture invoices set `earlyNetConsent = true` so the reviewer can settle immediately.
* **FR-1.2 (P1) Public register.** Either party (or the operator) may submit both signatures on-chain. Replay-protected by nonce + registry.
* **FR-1.3 (P2) Compliance pre-screen.** Before `register`, the application calls Circle [Compliance Engine](https://developers.circle.com/w3s/docs/compliance-engine) address screening and/or a vendor listed at [docs.arc.io/arc/tools/compliance-vendors](https://docs.arc.io/arc/tools/compliance-vendors) (Chainalysis, Elliptic, TRM Labs). Flagged addresses are not inserted into the solver graph. This is **application-layer**. Arc validators do not screen senders. Compliance Engine access is eligibility-gated by Circle — Phase 1 may ship with a stub + manual denylist if API access is not granted in time.

### 4.2 Graph and cycle detection

* **FR-2.1 (P1) Graph.** Directed graph, vertices = screened (or demo) addresses, edges = active invoices, weight = `amountRemaining` in USDC.
* **FR-2.2 (P1) Cycle finder.** Bounded Johnson as in §3.3. Phase 1 ships with a **fixture graph** of the three ads parties so the demo is deterministic. Live discovery is on but not required for the Microgrant path.
* **FR-2.3 (P1 quote / P2 execute) Mixed-currency quoting.** The Phase 1 dashboard includes a labeled **`kit.estimateSwap` panel** for a hypothetical USDC→EURC residual (quote only, not executed). An estimate is not a fill ([estimate-swap-rate](https://docs.arc.network/app-kit/tutorials/swap/estimate-swap-rate)). Actual `kit.swap` is Phase 2, a later separate tx with `slippageBps` / `stopLimit`. **P1 does not register EURC invoices.**

### 4.3 Settlement

* **FR-3.1 (P1) Atomic same-asset cancel.** `settle(invoiceIds, wNet)` as in §3.2. Permissionless caller. Single transaction, full revert, zero protocol fee.
* **FR-3.2 (P2) FX as a follow-on.** If a residual or a mixed-currency commercial need exists, the treasury calls `kit.swap({ tokenIn, tokenOut, amountIn, config: { kitKey, slippageBps } })` **after** (or independently of) netting. Requires a Circle `KIT_KEY` for production-rate Swap Kit usage. Provider fees and slippage apply; documented Swap Kit example on testnet showed ~1% all-in vs par on a 1.00 USDC→EURC estimate — **not zero-spread**.
* **FR-3.3 (P2) Residuals via Unified Balance.** Asymmetric leftover after netting is a normal **remaining invoice**, not an automatic pull from Ethereum. To pay a residual from another chain: (1) `kit.unifiedBalance.deposit` on the source chain into Circle Gateway, (2) `kit.unifiedBalance.spend` onto Arc to the creditor. These are two (or more) transactions. Funds must already be in Gateway to “spend instantly.” SCA / some Circle wallet types need a **delegate EOA** to sign spends ([Unified Balance](https://docs.arc.io/app-kit/unified-balance)).

### 4.4 Exceptions (specified so we do not pretend they do not exist)

Phase 1: revert-only. Documented, not implemented as queues.

| Case | P1 behavior | Later |
| :--- | :--- | :--- |
| Missing / stale signature | `register` reverts | — |
| Invoice already reduced below `wNet` | `settle` reverts | Solver refreshes graph |
| One party disputes | No on-chain dispute. They simply do not sign / do not consent. | Dispute flag + exclusion from solver |
| Sanction hit after register | P1: none. | Operator excludes from next batch; cannot claw back a completed settle |
| Solver proposes a cycle a party dislikes | P1: UI is operator-ranked; `settle()` is permissionless so a participant can submit a different valid cycle. | P2: threshold-sign the batch hash |
| Swap fills, settle reverts (if someone wires them together) | **Forbidden composition in P1.** | P2 orchestrator must swap only after settle receipt, or use an explicit two-phase with user confirmation |

---

## 5. Trust model

| Actor | Can do | Cannot do |
| :--- | :--- | :--- |
| **Anyone** | Register a bilaterally signed invoice. Call `settle()` if on-chain cycle checks pass. | Cancel invoices that are not a valid cycle; over-cancel `wNet`. |
| **Phase 1 operator** | Run the solver UI; highlight a cycle; click settle in the demo. Screen or exclude addresses from the *proposed* graph. | Invent amounts; skip signatures; monopolize the right to settle. |
| **Settler contract** | Subtract `wNet` atomically. | Hold user funds; talk to App Kits; legally extinguish debt. |
| **Circle / Arc validators** | Order and finalize the tx. Permissioned set reduces classic public-mempool sandwiches. | Guarantee solver fairness; screen counterparties; provide statutory netting. |
| **App Kit / Gateway** | Move or swap USDC when separately invoked. | Join the settler’s revert boundary. |

**MEV / fairness (precise language):** Arc’s permissioned, deterministically ordered consensus reduces public-mempool priority-gas auctions against `settle()`. The remaining discretion is **which cycle the operator UI proposes first**. Settlement itself is permissionless. Call that proposal trust, not “MEV-proof settlement.”

---

## 6. Circle stack — actual integration map

Sources: [App Kits](https://docs.arc.io/app-kit), [SDK reference](https://docs.arc.io/app-kit/references/sdk-reference), [Unified Balance](https://docs.arc.io/app-kit/unified-balance), [DCW](https://developers.circle.com/wallets/dev-controlled), [Compliance Engine](https://developers.circle.com/w3s/docs/compliance-engine).

| Component | Real API | Phase | Role in Contraflow |
| :--- | :--- | :--- | :--- |
| Swap Kit | `kit.estimateSwap`, `kit.swap`, `slippageBps` / `stopLimit`, `KIT_KEY` | P1 quote in UI optional; P2 execute | Show USDC⇄EURC rate. Never called from Solidity. |
| Unified Balance | `deposit` → Gateway; then `spend`. `estimateSpend`, delegates | P2 | Residual funding onto Arc **after** netting. Not “no pre-bridge.” |
| Bridge Kit | `kit.bridge` / `estimateBridge` (USDC, CCTP) | P2 alt | If Gateway is not used. |
| Earn Kit | — | **Out of scope** | Vault deposits re-lock working capital. Revisit only with explicit custody UX. |
| Developer-Controlled Wallets | Circle APIs + `@circle-fin/adapter-circle-wallets` | P2 | Headless submit of App Kit calls (and optionally `settle`). **No built-in policy engine** — limits, allowlists, and cycle-length caps are Contraflow application logic *before* the API call. |
| Compliance | Compliance Engine (eligibility-gated) + Chainalysis / Elliptic / TRM APIs | P2 | Pre-register / pre-solve screen. Not a validator precompile. |
| Native USDC gas | Protocol | P1 | Single-asset OpEx for deploy and `settle`. |

---

## 7. Positioning versus other EVM chains

Keep this honest. The moat is Arc’s **gas + finality + Circle stack adjacency**, not fictional consensus AML.

| Dimension | Generic EVM | Contraflow on Arc |
| :--- | :--- | :--- |
| Gas | Volatile (ETH, POL, …) | Native USDC, design target ~$0.01/tx under normal load ([gas and fees](https://docs.arc.io/arc/references/gas-and-fees); **re-measure on mainnet**) |
| Tooling | Ad hoc bridges / AMMs | App Kits for sequenced (not atomic) FX and Gateway |
| Cross-chain cash | Manual bridge | Gateway Unified Balance **after deposit** |
| Ordering | Public mempool MEV | Permissioned deterministic ordering; solver fairness is separate |
| FX | AMM slippage | Swap Kit stablecoin service; fees + slippage, not zero-spread |
| Compliance | App-layer vendors | Same: app-layer vendors named by Arc docs. Validators are permissioned; they do not KYT your counterparties |
| Legal finality | Off-chain contracts | Same: master netting agreement is Phase 3 |

---

## 8. Non-functionals, security, performance

### 8.1 Security (Phase 1)

* Settler never holds tokens. Cancel is storage math on invoice structs.
* EIP-712 domain binds `chainId` + registry address.
* `wNet` and path checked on-chain; operator cannot over-cancel.
* No upgrade proxy in Phase 1. Non-upgradeable contracts.
* Operator key can grief *liveness of the demo UI* (not propose a cycle). It cannot block a participant from calling `settle()` with valid calldata, and it cannot steal registered invoice value, because there is no locked value.

### 8.2 Performance targets (measure; do not put on the DoraHacks page as facts)

| Target | Number | Status |
| :--- | :--- | :--- |
| `settle` gas, 3-node cycle | Record actual mainnet gas; hope `< 250k` | Unmeasured |
| User-visible fee | Arc design target ~$0.01/tx; gas-and-fees page still notes some bounds as testnet-era | Re-read docs + measure |
| Fixture solve | Instant on 3–5 nodes | Trivial |
| Production solver | `|V|≤32`, `K≤5` | Cap exists so Johnson cannot explode |

### 8.3 Accounting and law

* Phase 1 emits an **immutable settlement receipt**: invoice ids, `wNet`, tx hash, block number, both EIP-712 hashes.
* That receipt **supports** an auditor. It does **not** prove IFRS 9 or ASC 405-20 derecognition.
* Statutory set-off / netting requires a **master netting agreement** (and local law) among the consortium. That is Phase 3. UI copy: “On-chain cancel (protocol)” not “legally extinguished.”

---

## 9. Phase 1 user experience

### 9.1 Screens

1. **Connect** — Arc mainnet `5042`. Show native USDC for gas vs ERC-20 USDC for invoices.
2. **Attest** — three fixture roles (Northwind DSP, Meridian Exchange, Atlas Publisher). Each wallet signs EIP-712 with `earlyNetConsent = true`; registry tx per invoice.
3. **Radar** — graph of three nodes, one cycle highlighted, `W_net` and **gross unlocked = 3 × W_net**, cash moved = `$0`.
4. **Settle** — permissionless `settle()`; demo button uses the operator wallet. Explorer link.
5. **Quote (not a fill)** — `kit.estimateSwap` panel for a hypothetical USDC→EURC residual, labeled quote-only.
6. **Receipt** — block, hash, before/after remaining amounts.

### 9.2 Dashboard metrics

The v2 mock ($3,450,000 unlocked, 74.2%, $18,420 Earn, 4.1x) is **illustrative marketing from a prior draft**. It must not appear as live telemetry.

Phase 1 live tiles, computed from chain:

| Tile | Formula |
| :--- | :--- |
| Gross cancelled | `sum(wNet × cycleLength)` over successful `settle` events |
| Cash moved | `0` for pure cancels |
| Multiplier | `gross cancelled / max(cash moved, 1 wei)` — for the 3-node demo this is **3.0x** if `wNet` equals each face (or `3 × wNet / 0` → display “∞ cash-drain avoided” / “no cash moved”) |
| Gas paid | actual native USDC from the settle receipt |

---

## 10. KPIs and roadmap

### 10.1 KPI ladder

| KPI | Phase 1 success | Later target (aspirational) |
| :--- | :--- | :--- |
| Live mainnet cancel | 1 public 3-node settle, $0 transferred | — |
| Liquidity multiplier | 3.0x on the fixture (by construction) | ≥ 3.5x on a real consortium graph |
| Netting efficiency | 100% of the fixture cycle | ≥ 70% of registered volume in a live cluster |
| Swap share | Quote panel only | ≥ 25% of loops use a **follow-on** Swap Kit fill |
| Gas / $10k cancelled | Measure | Keep vs Arc’s ~$0.01/tx design point |

### 10.2 Phased implementation

| Phase | When | Build | Outcome |
| :--- | :--- | :--- | :--- |
| **1. Arc Microgrants** | Weeks 1–3 (submit by 14 Oct 2026 23:59 ET) | Registry + Settler on **mainnet 5042**. Ads fixture solver. Next.js radar. Permissionless `settle()`. `estimateSwap` quote panel. Public repo. | DoraHacks-complete PoC. Rolling review — submit as soon as the live link works. |
| **2. Circle Grants / pilots** | Months 2–4 | Application-layer compliance screen. DCW for App Kit orchestration (policies in *our* code). Sequenced `settle` then optional `swap` / Gateway `deposit+spend`. One small ads or trade consortium. | Grant packet: production-shaped orchestration on top of a proven atomic core. |
| **3. Institutional** | Months 5–8 | ERP connectors. Master netting agreement (US/UK counsel). Privacy review (invoice graph is commercially sensitive; Arc privacy sector is not in P1). Raise cycle cap. | Only after legal + a real graph. Volume targets ($25M/mo) are **not** a Phase 1 promise. |

---

## 11. Phase 1 acceptance tests

A Microgrant submission is **done** when all of the following pass on Arc mainnet:

1. Three invoices registered with distinct debtor/creditor pairs forming a cycle, each with two valid EIP-712 signatures, visible on [explorer.arc.io](https://explorer.arc.io).
2. `settle([id0,id1,id2], wNet)` succeeds. Each `amountRemaining` decreased by `wNet`. Token balances of the three wallets **unchanged** (apart from gas on the sender).
3. A second `settle` with the same ids and a `wNet` greater than remaining **reverts**.
4. A `settle` with a broken path (not a cycle) **reverts**.
5. Dashboard shows the tx hash and the $0 cash-moved line.
6. README lists chain ID `5042`, contract addresses, ERC-20 USDC address, how to fund gas, that `settle()` is permissionless, and that Swap Kit is quote-only in this demo.
7. Nothing in the UI says “legally extinguished,” “zero-spread,” “MEV-proof,” or “validator OFAC.”

---

## 12. Non-goals (Phase 1)

* Calling `kit.swap` / `unifiedBalance.spend` / `earn.deposit` from `ContraflowSettler`.
* Executing a Swap Kit fill in Phase 1 (quotes only).
* EURC-denominated invoices.
* Circle Earn / vault float.
* SAP / NetSuite / Workday.
* IFRS/ASC legal memos.
* Tokenizing invoices, factoring, or taking protocol fees.
* Privacy-preserving graph (public invoice counterparties in P1).
* Restricting `settle()` to an operator role.

---

## 13. EIP-712 sketch (Phase 1)

```solidity
bytes32 constant INVOICE_TYPEHASH = keccak256(
  "InvoiceAttestation(bytes32 invoiceRef,uint256 amount,address currency,uint64 maturity,bool earlyNetConsent,address debtor,address creditor,uint256 nonce,address registry,uint256 chainId)"
);
```

Off-chain signers use the registry’s EIP-712 domain (`name = "ContraflowRegistry"`, `version = "1"`, `chainId = 5042`, `verifyingContract = registry`). Both signatures are over the **same** struct hash. `currency` must equal the canonical ERC-20 USDC address on Arc.

---

## 14. References

* [Arc Microgrants](https://dorahacks.io/hackathon/arc-microgrants/detail)
* [Circle Arc mainnet launch](https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet) (16 Sep 2026)
* [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc) — testnet params; mainnet `5042` / `rpc.mainnet.arc.io` / `explorer.arc.io`
* [Gas and fees](https://docs.arc.io/arc/references/gas-and-fees) — native USDC 18 decimals vs ERC-20 6 decimals; ~$0.01/tx design target
* [App Kits](https://docs.arc.io/app-kit) · [SDK reference](https://docs.arc.io/app-kit/references/sdk-reference) · [estimateSwap](https://docs.arc.network/app-kit/tutorials/swap/estimate-swap-rate) · [Unified Balance](https://docs.arc.io/app-kit/unified-balance)
* [Compliance vendors on Arc](https://docs.arc.io/arc/tools/compliance-vendors) · [Compliance Engine](https://developers.circle.com/w3s/docs/compliance-engine)
* [Developer-controlled wallets](https://developers.circle.com/wallets/dev-controlled) — no built-in policy engine
* [circlefin/arc-fintech](https://github.com/circlefin/arc-fintech) — reference composition of DCW + App Kit + Compliance Engine (Earn in that sample is not part of Contraflow)

---

## 15. Decisions (closed in 3.1.0)

| # | Decision | Resolution |
| :--- | :--- | :--- |
| 1 | Early netting | **`earlyNetConsent`** in the EIP-712 attestation. Settle allowed if matured **or** both parties signed consent. Fixture uses consent = true. |
| 2 | Upgradeability | **Non-upgradeable** Phase 1. |
| 3 | Who calls `settle()` | **Permissionless.** On-chain cycle checks are the only gate. Demo UI uses an operator EOA for one-click UX. Recommendation: do not add an onlyOperator modifier — it would make capital unlock depend on us, which is a worse trust story than the contract already provides. |
| 4 | Protocol fee | **Zero.** Demo must move $0 cash besides gas. |
| 5 | Fixture | **Ads-themed, still synthetic:** Northwind DSP / Meridian Exchange / Atlas Publisher. |
| 6 | Swap in P1 | **`estimateSwap` quote panel**, labeled not-executed. |
| 7 | Earn | **Dropped** from the product story until a dedicated custody UX exists. |
| 8 | Solver fairness (P2) | Still open for the Grant phase: batch-hash co-sign vs named proposer. Does not block Phase 1. |
| 9 | Product name | **Contraflow.** Not ArcNet. Pitch: “Contraflow on Arc.” |
