#!/usr/bin/env node
// Prints the `addresses.ts` entry for a deployment from Foundry's own broadcast output, so no
// address or block number is ever typed by hand.
//
//   node scripts/addresses-from-broadcast.mjs --chain 5042
//   node scripts/addresses-from-broadcast.mjs --chain 5042002 --broadcast-dir ../contracts/broadcast
//   node scripts/addresses-from-broadcast.mjs --chain 5042 --dry-run     # simulation output (no block numbers)
//
// It reads `Deploy.s.sol` (Registry + Settler) and `DeployNettingLedger.s.sol` and refuses anything
// that doesn't have the expected shape or whose receipts show a failure. Read-only.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
};
const chain = String(flag("chain") ?? "");
if (!/^(5042|5042002)$/.test(chain)) fail("Pass --chain 5042 (mainnet) or --chain 5042002 (testnet).");
const dryRun = flag("dry-run") === true;
const root = typeof flag("broadcast-dir") === "string" ? flag("broadcast-dir") : "../contracts/broadcast";
const USDC = "0x3600000000000000000000000000000000000000";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function load(script) {
  const path = join(root, `${script}.s.sol`, chain, dryRun ? "dry-run" : "", "run-latest.json");
  if (!existsSync(path)) fail(`Missing ${path}. Run the deploy script with --broadcast first${dryRun ? " (or without, for --dry-run)" : ""}.`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const creates = data.transactions.filter((t) => t.transactionType === "CREATE");
  return { creates, receipts: data.receipts ?? [] };
}

function blockOf(address, receipts) {
  if (dryRun) return null;
  const receipt = receipts.find((r) => r.contractAddress?.toLowerCase() === address.toLowerCase());
  if (!receipt) fail(`No receipt for ${address}: the transaction may not have been mined.`);
  if (receipt.status !== "0x1" && receipt.status !== 1 && receipt.status !== "success") fail(`The deployment of ${address} did not succeed (status ${receipt.status}).`);
  return BigInt(receipt.blockNumber);
}

// Registry and Settler: implementation, implementation, Registry proxy, Settler proxy.
const core = load("Deploy");
if (core.creates.length !== 4) fail(`Expected 4 contract creations in Deploy, found ${core.creates.length}.`);
const [registryImpl, settlerImpl, registryProxy, settlerProxy] = core.creates;
if (registryImpl.contractName !== "ContraflowRegistry" || settlerImpl.contractName !== "ContraflowSettler" ||
    registryProxy.contractName !== "ERC1967Proxy" || settlerProxy.contractName !== "ERC1967Proxy") {
  fail("Deploy's creations are not in the expected order (Registry, Settler, Registry proxy, Settler proxy).");
}

const ledger = load("DeployNettingLedger");
if (ledger.creates.length !== 2) fail(`Expected 2 contract creations in DeployNettingLedger, found ${ledger.creates.length}.`);
const [ledgerImpl, ledgerProxy] = ledger.creates;
if (ledgerImpl.contractName !== "ContraflowNettingLedger" || ledgerProxy.contractName !== "ERC1967Proxy") {
  fail("DeployNettingLedger's creations are not in the expected order (implementation, proxy).");
}

const registry = getAddress(registryProxy.contractAddress);
const settler = getAddress(settlerProxy.contractAddress);
const nettingLedger = getAddress(ledgerProxy.contractAddress);
const registryBlock = blockOf(registry, core.receipts);
blockOf(settler, core.receipts);
blockOf(nettingLedger, ledger.receipts);

const label = chain === "5042" ? "ARC_MAINNET_ADDRESSES" : "ARC_TESTNET_ADDRESSES";
console.log(`// From Foundry's broadcast output for chain ${chain}${dryRun ? " (SIMULATION: do not record)" : ""}.`);
console.log(`const ${label}: ChainAddresses = {`);
console.log(`  registry: "${registry}",`);
console.log(`  settler: "${settler}",`);
console.log(`  usdc: "${USDC}",`);
console.log(`  registryDeployBlock: ${registryBlock === null ? "0n /* simulation: no block */" : `${registryBlock}n`},`);
console.log(`  nettingLedger: "${nettingLedger}",`);
console.log(`};`);
console.log("");
console.log("// Implementations (for verification and upgrade records):");
console.log(`//   Registry   ${getAddress(registryImpl.contractAddress)}`);
console.log(`//   Settler    ${getAddress(settlerImpl.contractAddress)}`);
console.log(`//   Ledger     ${getAddress(ledgerImpl.contractAddress)}`);
console.log("");
console.log("// Confirm onchain before recording:");
console.log(`//   cast code ${registry} --rpc-url <rpc>`);
console.log(`//   cast call ${registry} "owner()(address)" --rpc-url <rpc>`);
console.log(`//   cast call ${registry} "settler()(address)" --rpc-url <rpc>   # = ${settler}`);
console.log(`//   cast call ${nettingLedger} "owner()(address)" --rpc-url <rpc>`);
