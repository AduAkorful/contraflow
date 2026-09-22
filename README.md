# Contraflow

Contraflow on Arc — cancel circular A/P so invoices die and no USDC moves.

**Spec (strategy source of truth):** [plans/contraflow-spec.md](plans/contraflow-spec.md)  
**Hackathon rails:** [plans/hackathon-overview.md](plans/hackathon-overview.md)  
**Agent checkpoint / handoff:** [AGENTS.md](AGENTS.md) — start at **Handoff snapshot**.

Phase 1 is an Arc Microgrant PoC: two contracts, a fixture solver, a Next.js radar, live on Arc mainnet (`5042`). Do not start application code until `plans/00-architecture.md` exists and the operator accepts it.

## License

This repository is public for viewing and audit purposes — it is **not open source**. See [LICENSE](LICENSE) for full terms.

- `contracts/` is licensed under the [Business Source License 1.1](contracts/LICENSE) — publicly viewable, not licensed for production use, converting to MIT on 2030-09-22.
- Everything else in this repository is proprietary — all rights reserved, no license granted to use, copy, modify, or redistribute.
