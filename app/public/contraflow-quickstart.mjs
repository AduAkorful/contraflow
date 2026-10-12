// Contraflow sandbox quick-start: three companies, one loop, one applied certificate.
//
// What it does, in order, on the network your key belongs to (a cfk_live_ key runs on Arc mainnet,
// a cfk_test_ key on Arc testnet):
//   1. creates three company wallets (they only sign; they never need funds)
//   2. each company grants your API key a signed permission
//   3. records three obligations in a circle: A owes B 1000, B owes C 800, C owes A 600
//   4. finds the loop, collects each company's signature, applies the certificate onchain
//
// Needs Node 20+ and viem:  npm install viem
// Run:
//   CONTRAFLOW_API_KEY=cfk_live_...  PAYER_PRIVATE_KEY=0x...  node contraflow-quickstart.mjs
//
// CONTRAFLOW_API_KEY  your key from https://contraflow.vercel.app/app/api-keys
// PAYER_PRIVATE_KEY   a wallet on the key's network holding a little USDC for gas (the only wallet
//                     that pays, about 0.005 USDC). It sends the apply transaction; Contraflow never does.
//                     On mainnet this is real USDC and the applied certificate is a real onchain event.
// CONTRAFLOW_API_URL  optional, defaults to https://contraflow.vercel.app/api/v1
//
// Never commit keys. Read them from the environment, as here.

import { randomBytes, randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http, keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const API = (process.env.CONTRAFLOW_API_URL ?? "https://contraflow.vercel.app/api/v1").replace(/\/$/, "");
const KEY = process.env.CONTRAFLOW_API_KEY;
const PAYER_KEY = process.env.PAYER_PRIVATE_KEY;
if (!KEY || !/^cfk_(live|test)_/.test(KEY)) throw new Error("Set CONTRAFLOW_API_KEY to your cfk_live_ or cfk_test_ key.");
if (!PAYER_KEY) throw new Error("Set PAYER_PRIVATE_KEY to the key of a wallet funded with USDC for gas.");

// The key decides the network. GET /tenant reports its chain id, and the transaction goes there.
const NETWORKS = {
  5042: { name: "Arc", rpc: process.env.ARC_RPC_URL ?? "https://rpc.mainnet.arc.io" },
  5042002: { name: "Arc Testnet", rpc: process.env.ARC_RPC_URL ?? process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.io" },
};
function arcChain(chainId) {
  const network = NETWORKS[chainId];
  if (!network) throw new Error(`This key is for chain ${chainId}, which the script doesn't know.`);
  return defineChain({
    id: chainId,
    name: network.name,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [network.rpc] } },
  });
}

// --- API helper -------------------------------------------------------------------------------

async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  // Every POST carries an Idempotency-Key. If you add retries, resend the same key so a repeat can't create a second effect.
  if (method === "POST") headers["Idempotency-Key"] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error?.code}: ${json?.error?.message}`);
  return json;
}

// --- signing ----------------------------------------------------------------------------------

// The API returns typed data with integers as strings. viem must hash them as bigints, or the
// signature will not match what the ledger computes.
function signable(typedData) {
  const fields = typedData.types[typedData.primaryType];
  const message = { ...typedData.message };
  for (const { name, type } of fields) {
    if (/^u?int\d*$/.test(type)) message[name] = BigInt(message[name]);
    else if (/^u?int\d*\[\]$/.test(type)) message[name] = message[name].map((v) => BigInt(v));
  }
  return { ...typedData, domain: { ...typedData.domain, chainId: BigInt(typedData.domain.chainId) }, message };
}

// Sign exactly what the API returned, and check its digest first.
async function signEnvelope(account, envelope) {
  const data = signable(envelope.typedData);
  if (hashTypedData(data) !== envelope.digest) throw new Error("The typed data does not match its digest.");
  return account.signTypedData(data);
}

// --- obligation document (see the API reference, "How to build it") ---------------------------

function documentHash(doc) {
  const canonical = JSON.stringify({
    amount: doc.amount,
    creditor: doc.creditor.toLowerCase(),
    currency: doc.currency,
    debtor: doc.debtor.toLowerCase(),
    description: doc.description.trim(),
    earlyNetConsent: doc.earlyNetConsent,
    format: doc.format,
    maturity: doc.maturity,
  });
  return keccak256(toHex(canonical));
}

const OBLIGATION_TYPES = [
  { name: "documentHash", type: "bytes32" },
  { name: "debtor", type: "address" },
  { name: "creditor", type: "address" },
  { name: "currency", type: "string" },
  { name: "amount", type: "uint256" },
  { name: "maturity", type: "uint64" },
  { name: "earlyNetConsent", type: "bool" },
  { name: "salt", type: "bytes32" },
];

// --- run --------------------------------------------------------------------------------------

const log = (message) => console.log(`\n${message}`);

const tenant = await api("GET", "/tenant");
log(`Tenant ${tenant.tenantId.slice(0, 10)}…  chain ${tenant.chainId}  ledger ${tenant.ledger}`);

const names = ["Atlas", "Meridian", "Northwind"];
const companies = names.map((name) => ({ name, account: privateKeyToAccount(generatePrivateKey()) }));
const [A, B, C] = companies;

// 1. Each company grants the key read (1) + propose (2) + deliverSignatures (4) for an hour.
log("1. Permissions");
const expiresAt = String(Math.floor(Date.now() / 1000) + 3600);
for (const company of companies) {
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const query = new URLSearchParams({ party: company.account.address, scopes: "7", expiresAt, nonce });
  const envelope = await api("GET", `/permissions/typed-data?${query}`);
  const signature = await signEnvelope(company.account, envelope);
  await api("POST", "/permissions", {
    permission: { party: company.account.address, tenantId: tenant.tenantId, scopes: 7, expiresAt, nonce },
    signature,
  });
  console.log(`   ${company.name} ${company.account.address} granted a permission`);
}

// 2. Three obligations in a circle. The debtor proposes and signs; the creditor accepts and signs.
log("2. Obligations");
const domain = { name: "ContraflowNettingLedger", version: "1", chainId: tenant.chainId, verifyingContract: tenant.ledger };
const maturity = "2026-12-31";
const maturityUnix = String(Math.floor(Date.UTC(2026, 11, 31) / 1000));
const circle = [
  [A, B, "1000.00"],
  [B, C, "800.00"],
  [C, A, "600.00"],
];
for (const [debtor, creditor, amount] of circle) {
  const document = {
    format: "contraflow-obligation/1",
    description: `Sandbox invoice ${debtor.name} to ${creditor.name}`,
    debtor: debtor.account.address,
    creditor: creditor.account.address,
    currency: "USD",
    amount,
    maturity,
    earlyNetConsent: true,
  };
  const obligation = {
    documentHash: documentHash(document),
    debtor: document.debtor,
    creditor: document.creditor,
    currency: "USD",
    amount: String(Math.round(Number(amount) * 100)),
    maturity: maturityUnix,
    earlyNetConsent: true,
    salt: `0x${randomBytes(32).toString("hex")}`,
  };
  const proposerSignature = await debtor.account.signTypedData({
    domain,
    types: { NettingObligation: OBLIGATION_TYPES },
    primaryType: "NettingObligation",
    message: { ...obligation, amount: BigInt(obligation.amount), maturity: BigInt(obligation.maturity) },
  });
  const { proposal } = await api("POST", "/obligations/proposals", {
    party: debtor.account.address,
    proposerRole: "debtor",
    document,
    obligation,
    proposerSignature,
  });
  const signature = await signEnvelope(creditor.account, { typedData: proposal.typedData, digest: proposal.digest });
  await api("POST", `/obligations/proposals/${proposal.token}/accept`, { party: creditor.account.address, signature });
  console.log(`   ${debtor.name} owes ${creditor.name} ${amount} USD: recorded`);
}

// 3. Find the loop through Atlas.
log("3. Loop");
const { outcome } = await api("POST", `/parties/${A.account.address}/loops`, {});
if (!outcome.found) throw new Error(`No loop found: ${outcome.reason}: ${outcome.message}`);
console.log(`   ${outcome.parties} companies, netting ${outcome.wNetDisplay} ${outcome.currency}`);
const token = outcome.token;

// 4. Each company signs the certificate.
log("4. Signatures");
for (const company of companies) {
  const view = await api("GET", `/certificates/${token}?party=${company.account.address}`);
  const signature = await signEnvelope(company.account, { typedData: view.typedData, digest: view.digest });
  await api("POST", `/certificates/${token}/signatures`, { party: company.account.address, signature });
  console.log(`   ${company.name} signed`);
}

// 5. Apply. Anyone can send it; the payer wallet pays gas.
const arc = arcChain(tenant.chainId);
log(`5. Apply on ${arc.name}`);
const tx = await api("GET", `/certificates/${token}/apply-transaction?party=${A.account.address}`);
if (tx.submit?.estimatedCostUsdc) console.log(`   estimated gas cost ${tx.submit.estimatedCostUsdc} USDC`);
const payer = privateKeyToAccount(PAYER_KEY.startsWith("0x") ? PAYER_KEY : `0x${PAYER_KEY}`);
const wallet = createWalletClient({ account: payer, chain: arc, transport: http() });
const publicClient = createPublicClient({ chain: arc, transport: http() });
const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`The apply transaction failed: ${hash}`);
await api("POST", `/certificates/${token}/transactions`, { party: A.account.address, txHash: hash });
console.log(`   applied in ${hash}`);

// 6. Read the result back.
log("6. Result");
// Each company sees only its own obligations, so read all three and show every one once.
const nameOf = (address) => companies.find((c) => c.account.address.toLowerCase() === address.toLowerCase())?.name ?? address;
const seen = new Map();
let cert;
for (const company of companies) {
  const { certificates, obligations } = await api("GET", `/parties/${company.account.address}/obligations`);
  cert ??= certificates.find((c) => c.token === token);
  for (const o of obligations) {
    if (!o.youOwe) continue; // each obligation is listed once, from its debtor's side
    seen.set(o.obligationId, `${company.name} owes ${nameOf(o.counterparty)} ${o.amountDisplay} USD, remaining ${o.remainingDisplay}, ${o.status}`);
  }
}
console.log(`   certificate ${cert?.status}, netted ${cert?.wNetDisplay} USD`);
for (const line of seen.values()) console.log(`   ${line}`);
console.log("\nDone. Verify the certificate at https://contraflow.vercel.app/app/verify");
