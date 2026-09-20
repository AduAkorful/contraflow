#!/usr/bin/env node
// Copies the ABI array out of Foundry's build artifacts (contracts/out/, gitignored) into
// app/src/contracts/abi/*.json (checked in, small, stable). Run after `forge build` whenever a
// contract interface changes. See app/src/contracts/abi/index.ts for why this copy exists.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(appDir);

const contracts = [
  { name: "ContraflowRegistry", artifact: "contracts/out/ContraflowRegistry.sol/ContraflowRegistry.json" },
  { name: "ContraflowSettler", artifact: "contracts/out/ContraflowSettler.sol/ContraflowSettler.json" },
];

for (const { name, artifact } of contracts) {
  const artifactPath = join(repoRoot, artifact);
  const { abi } = JSON.parse(readFileSync(artifactPath, "utf8"));
  const outPath = join(appDir, "src", "contracts", "abi", `${name}.json`);
  writeFileSync(outPath, `${JSON.stringify(abi, null, 2)}\n`);
  console.log(`wrote ${outPath} (${abi.length} entries)`);
}
