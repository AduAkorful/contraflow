/// Re-exports the two contract ABIs as `const`-typed arrays (viem needs `as const` for its type
/// inference on `readContract`/`writeContract`/`encodeFunctionData`). Copied from
/// `contracts/out/*/*.json` (gitignored Foundry build output) — regenerate with
/// `pnpm --filter @contraflow/app sync-abi` after any change to the Solidity interfaces, never
/// hand-edit these JSON files.

import contraflowRegistryAbiJson from "./ContraflowRegistry.json" with { type: "json" };
import contraflowSettlerAbiJson from "./ContraflowSettler.json" with { type: "json" };

export const contraflowRegistryAbi = contraflowRegistryAbiJson;
export const contraflowSettlerAbi = contraflowSettlerAbiJson;
