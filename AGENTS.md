# AGENTS.md — contraflow checkpoint

> **Living handoff file.** Read this, `plans/contraflow-spec.md`, and `plans/hackathon-overview.md` before doing anything.
> Update this file in the **same session** as any decision, milestone, architecture change, or meaningful code change. Newest entries go at the **top** of the log. Never rewrite or delete old log entries.

This project **deploys to Arc mainnet and spends real USDC for gas**. Do not rush. Do not skip planning. Do not land a giant unreviewed slice. Do not submit a testnet build.

---

## Handoff snapshot — 2026-09-17 (read this first)

Cold start: **this file + spec + hackathon overview**. Do **not** need the prior chat.

**Where we are:** Product named **Contraflow** (not ArcNet). Spec **v3.2.0** locked for Phase 1. Hackathon rails written. **No architecture plan. No application code. No contracts.** Next operator-facing work is a written `plans/00-architecture.md` + first implementation step plan, then wait for accept.

**Git:** new repo `~/dev/contraflow`, branch `main`. Docs only.

**Hackathon:** [Arc Microgrants](https://dorahacks.io/hackathon/arc-microgrants/detail). Close **14 Oct 2026 23:59 ET**. Rolling review — submit when spec §11 is green on **mainnet 5042**, not on the deadline. 20 × 500 USDC. Must be live Arc mainnet + public repo.

**Read, in order (stop there unless coding that slice):**

1. This snapshot + Current status
2. `plans/contraflow-spec.md` (strategy; Phase 1 vs 2/3; trust model; §11 acceptance)
3. `plans/hackathon-overview.md` (eligibility, scoring, listing copy, timeline)
4. `plans/00-architecture.md` when it exists
5. Current `plans/NN-*.md` for the slice

**Do not read** the old conversation transcript. **Do not** treat Circle App Kits as Solidity. **Do not** implement until architecture + that step’s plan are accepted.

| Run | Command |
|---|---|
| Tests | None yet. After Foundry exists: `forge test`. After the app exists: whatever `00-architecture` locks. |
| Deploy | Not until the step plan says mainnet. Rehearse on testnet `5042002` if useful; **submit only mainnet `5042`**. |

**Code that exists**

- None. Repo is plans + this file + README.

**Not built:** Registry, Settler, solver, dashboard, App Kit quote panel, deploy scripts.

**Next (operator-facing):** Write `plans/00-architecture.md` and `plans/01-*.md` when asked. Do not chain implementation in that session unless the operator says proceed.

**Rails the next agent must not “improve” away:** same-asset in-place cancel only; `settle()` permissionless; protocol fee $0; USDC-only invoices in P1; App Kits off-chain and sequenced; `estimateSwap` is quote-only; Earn out of product; non-upgradeable; ads fixture (DSP / Exchange / Publisher); no IFRS/legal-extinguish copy; no zero-spread / MEV-proof / validator-OFAC claims; native USDC 18 decimals vs ERC-20 USDC 6 decimals.

---

## How to start a session

1. Read **Handoff snapshot** (above) + Current status.
2. Read `plans/contraflow-spec.md` if the work can change protocol behavior, claims, or the demo.
3. Read `plans/hackathon-overview.md` if the work is submit-path, listing copy, or deadline.
4. Read `plans/00-architecture.md` and the current `plans/NN-*.md` for the slice (when they exist).
5. Do **not** start a new implementation step without a written plan for that step.

If the operator’s request conflicts with the spec or the hackathon rails, **stop and ask**. Do not silently override rails (permissionless settle, $0 fee, no Earn, no kit-in-settler, mainnet submit).

**Spec beats marketing and third-party skills.** Circle App Kit samples, Arc testnet docs, and “institutional” language in old drafts must not pull FX, Gateway, or Earn into `ContraflowSettler`.

---

## Identity

| | |
|---|---|
| **Project** | contraflow |
| **Path** | `~/dev/contraflow` |
| **Operator** | single builder (Arc Microgrant → Circle Grant path) |
| **What it is** | Multilateral A/P–A/R netting on Arc: attest invoices, find cycles, cancel `W_net` in one tx so no USDC moves except gas |
| **What it is not yet** | A CCP, a legal netting service, an ERP plugin, or an atomic FX/Gateway engine. Phase 1 is a 3-node mainnet PoC |

**Documents**

| File | Role |
|---|---|
| `plans/contraflow-spec.md` | **Strategy** source of truth (Phase 1 scope, trust model, FRs, non-goals). Change only when the operator accepts a strategy change. |
| `plans/hackathon-overview.md` | **Hackathon rails** (eligibility, scoring, timeline, listing copy). Re-check DoraHacks before submit. |
| `AGENTS.md` | **Process, architecture, milestone, and session log.** This file. |
| `plans/<step>-*.md` | **Per-step build plans.** Intensive plan *before* that step’s code. |
| `README.md` | Short human intro. |

Do not keep a second conflicting strategy doc. If strategy changes, update the spec **and** log it here.

---

## Current status

**Phase:** Spec + hackathon rails. No architecture plan. No code.  
**Last updated:** 2026-09-17  
**Git:** new `main`, docs-only

| Milestone | Status |
|---|---|
| Problem / Arc Microgrant fit | Done (discussion) |
| v2 institutional PRD rewritten (no kit-in-settler, no fake AML/IFRS) | Done |
| Owner decisions (early-net consent, permissionless settle, ads fixture, $0 fee, quote panel, drop Earn) | Done |
| Product named Contraflow | Done |
| Spec in repo (`plans/contraflow-spec.md` v3.2.0) | Done |
| Hackathon overview (`plans/hackathon-overview.md`) | Done |
| `AGENTS.md` checkpoint | Done (this file) |
| Step-0 architecture (`plans/00-architecture.md`) | **Not started** |
| Step-1 plan | **Not started** |
| Contracts on Arc mainnet | **Not started** |
| Dashboard / solver | **Not started** |
| DoraHacks submit | **Not started** |

**Next:** When the operator asks, write architecture + first-step plan. Do not implement until accepted. Do not deploy mainnet until the step plan says so.

---

## Operating rules (mainnet USDC)

These are process rules. Protocol rails live in the spec.

1. **Small steps.** One milestone per session when possible. A step is done when it is planned, researched, implemented, tested, and logged here.
2. **Plan before code.** Every implementation step gets a focused plan in `plans/` (goal, non-goal, interfaces, failure modes, test plan). Intensive planning is required; “just start coding” is not.
3. **Research before integrating.** Arc, USDC decimals, App Kit method names, and chain IDs must be checked against **current** [docs.arc.io](https://docs.arc.io/) — not memory — before that step’s code. Docs still mix testnet samples.
4. **Fail closed.** Missing signatures, broken cycles, `wNet` too large, or wrong chain ID means **revert**. Never invent a fill, a quote, or a “legal extinguishment.”
5. **Testnet can rehearse; mainnet is the product.** The Microgrant is ineligible on testnet. Do not burn mainnet USDC on experiments that a testnet pass would catch.
6. **No secrets in git or this file.** Deployer keys, `KIT_KEY`, Circle entity secrets stay in `.env` (gitignored).
7. **Spec wins.** Phase 1 non-goals are binding. Do not add Earn, upgradeability, protocol fees, EURC invoices, or kit calls from Solidity without a spec change.
8. **Claims discipline.** Listing + UI copy must match spec §1.3. If a sentence would be false on a Circle engineer’s desk, delete it.

---

## Architecture (target)

Design for change: a later Swap fill, Gateway residual, or DCW operator should not require rewriting the settler.

**Plan:** `plans/00-architecture.md` — **not written**. Do not pick a stack in a random file.

### Stack (proposed, not locked)

| Piece | Lean (from spec Phase 1) | Status |
|---|---|---|
| Contracts | Solidity, Foundry | Propose in `00` |
| App | Next.js radar + fixture solver | Propose in `00` |
| Chain | Arc mainnet `5042`; testnet `5042002` for rehearsal | Spec-locked |
| Settlement asset | ERC-20 USDC 6 decimals | Spec-locked |
| Gas | Native USDC 18 decimals | Spec-locked |
| App Kit | `@circle-fin/app-kit` for `estimateSwap` only in P1 | Spec-locked |

### Bounded contexts (keep these separate when code exists)

| Context | Owns | Must not own |
|---|---|---|
| `registry` | Invoice storage, EIP-712 verify, nonce | Cycle math, tokens |
| `settler` | Path check, `wNet` subtract, revert-all | Swap, Gateway, Earn, fees |
| `solver` | Graph, bounded Johnson, propose calldata | Signing policy, legal copy |
| `app` | Radar, attest UX, quote panel, receipts | Inventing on-chain state |
| `kits` | `estimateSwap` (P1); later swap/spend | Being called from `settler` |

### Code quality (required)

- **Segment by context.** New behavior goes in the module that owns it. Do not grow god files.
- **Short files.** If a file is heading past ~300–400 lines, split it.
- **Interfaces first.** Solver outputs calldata; settler does not import App Kits.
- **Tests on money paths:** register/replay, cycle/path, `wNet`, early-net consent, permissionless settle, revert cases. A green happy path with no fail-closed tests is not done.
- **No silent catch.** Errors revert or surface.

---

## Per-step workflow

For **each** implementation step:

1. **Plan** — write `plans/<nn>-<slug>.md`: scope, out of scope, research notes, module layout, tests, rollback.
2. **Research** — current Arc / Circle docs for that slice. Log sources in the plan.
3. **Implement** — only that slice, in the right modules, with tests.
4. **Verify** — tests + any testnet rehearsal. Mainnet only when the plan says so.
5. **Log** — append a log entry here (and spec only if strategy changed).
6. **Stop** — do not chain the next step unless the operator asked for it.

---

## Log protocol

Append a new `###` heading **above** older entries (newest first).

```markdown
### YYYY-MM-DD — short title
- **Type:** decision | milestone | change | incident
- **What:** …
- **Why:** …
- **Files:** …
- **Follow-up:** …
```

Also update **Current status** and the milestone table when a phase changes.

---

## Session log

### 2026-09-17 — Repo + AGENTS.md checkpoint
- **Type:** milestone
- **What:** Created `~/dev/contraflow`. Copied spec to `plans/contraflow-spec.md`. Wrote `plans/hackathon-overview.md` and this handoff file. No application code. No architecture plan.
- **Why:** Operator asked for a repo under `dev/`, plans folder, spec, hackathon overview, and an `AGENTS.md` in the meme-desk format.
- **Files:** `AGENTS.md`, `README.md`, `.gitignore`, `plans/contraflow-spec.md`, `plans/hackathon-overview.md`
- **Follow-up:** When asked, write `plans/00-architecture.md` and the first step plan. Do not implement until accepted.

### 2026-09-17 — Product named Contraflow
- **Type:** decision
- **What:** Replaced ArcNet. Pitch: “Contraflow on Arc — cancel circular A/P so invoices die and no USDC moves.” Contracts `ContraflowRegistry` / `ContraflowSettler`. Avoid ClearLoop (Copper) and Cycles Protocol (academic).
- **Why:** ArcNet sounded like the L1.
- **Files:** spec v3.2.0 (now in `plans/contraflow-spec.md`)
- **Follow-up:** None on naming unless operator revises.

### 2026-09-17 — Phase 1 rails locked
- **Type:** decision
- **What:** Early-net via EIP-712 `earlyNetConsent`. Permissionless `settle()`. Ads fixture (Northwind DSP / Meridian Exchange / Atlas Publisher). Protocol fee $0. P1 `estimateSwap` quote-only. Earn dropped. Non-upgradeable. Atomic core is same-asset cancel; App Kits are sequenced TypeScript.
- **Why:** v2 PRD claimed kit-in-settler, validator AML, IFRS extinguishment, zero-spread FX. Those are false against current Circle/Arc docs.
- **Files:** spec v3.1.0 → v3.2.0
- **Follow-up:** Architecture plan when operator asks.

---

## Hard stops (do not do these)

- Submit a **testnet-only** build to Arc Microgrants.
- Call `kit.swap` / `unifiedBalance.spend` / `earn.*` from `ContraflowSettler`.
- Execute a Swap Kit **fill** in Phase 1 (quotes only).
- Add Earn, protocol fees, upgradeable proxies, or EURC invoices without a spec change.
- Restrict `settle()` to an operator role.
- Claim statutory extinguishment, zero-spread FX, MEV-proof settlement, or validator OFAC.
- Put live fake KPIs ($3.45M / 74.2% / 4.1x) on the dashboard.
- Put private keys, `KIT_KEY`, or Circle entity secrets in the repo or in this file.
- Start implementation without a written, accepted plan for that step.
- Follow a third-party skill when it conflicts with `plans/contraflow-spec.md`.
- Burn mainnet USDC on an untested deploy.
