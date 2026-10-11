#!/usr/bin/env node
// Independent recount of the "Live on Arc" stats, compared with what's stored.
//
// It recounts from the Blockscout explorer API (decoded logs), a different path from the app's
// RPC indexer, up to the stored cursor block, and diffs every total. Read-only: it only GETs the
// stored state from Upstash and never writes anything.
//
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/verify-stats.mjs
//   node scripts/verify-stats.mjs --upto <block>     # recount only, print totals as JSON
//
// Exit code 0 when everything matches, 1 on any difference.

const EXPLORER = "https://explorer.testnet.arc.io/api/v2";
const CHAIN_ID = 5042002;
const KEY = `stats:v2:${CHAIN_ID}`;
export const CONTRACTS = {
  registry: "0x304450Dc27f644AcA55773895409ff500AFb2Bf7",
  settler: "0x25851c3fa9438AA53B0bd6ecc3347010b3ccB015",
  ledger: "0x2F5996aaE68CbC8026543c405Cc81C26D58c2ef7",
};
const ADMIN = /^(Initialized|OwnershipTransferred|Upgraded|EIP712DomainChanged)\(/;

async function getJson(url, init) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return await res.json();
      last = new Error(`${url}: HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw last;
}

const param = (item, name) => item.decoded.parameters.find((p) => p.name === name)?.value;

/// Totals in the same shape as the app's `StatsTotals`, counting logs at or below `uptoBlock`.
export async function recountFromExplorer(uptoBlock) {
  const t = { invoicesRegistered: 0, faceValueRegistered: 0n, valueNetted: 0n, fullyNetted: 0, invoiceLoopsSettled: 0, certificatesApplied: 0, obligationUpdates: 0 };
  const parties = new Set();
  const problems = [];
  let first = null;
  for (const [name, address] of Object.entries(CONTRACTS)) {
    let page = null;
    do {
      const data = await getJson(`${EXPLORER}/addresses/${address}/logs${page ? `?${new URLSearchParams(page)}` : ""}`);
      for (const item of data.items) {
        if (BigInt(item.block_number) > uptoBlock) continue;
        if (!item.decoded) { problems.push(`undecoded ${name} log ${item.transaction_hash}`); continue; }
        const m = item.decoded.method_call;
        if (ADMIN.test(m)) continue;
        const ts = item.block_timestamp ?? null;
        if (ts && (!first || ts < first)) first = ts;
        if (name === "registry" && m.startsWith("InvoiceRegistered(")) {
          t.invoicesRegistered++; t.faceValueRegistered += BigInt(param(item, "amount"));
          parties.add(String(param(item, "debtor")).toLowerCase()); parties.add(String(param(item, "creditor")).toLowerCase());
        } else if (name === "registry" && m.startsWith("InvoiceNetted(")) {
          t.valueNetted += BigInt(param(item, "wNet")); if (String(param(item, "status")) === "1") t.fullyNetted++;
        } else if (name === "settler" && m.startsWith("Settled(")) t.invoiceLoopsSettled++;
        else if (name === "ledger" && m.startsWith("CertificateApplied(")) t.certificatesApplied++;
        else if (name === "ledger" && m.startsWith("ObligationAdvanced(")) t.obligationUpdates++;
        else problems.push(`unknown ${name} event ${m}`);
      }
      page = data.next_page_params;
    } while (page);
  }
  return {
    totals: { ...t, faceValueRegistered: t.faceValueRegistered.toString(), valueNetted: t.valueNetted.toString() },
    parties: parties.size,
    firstEventAt: first,
    problems,
  };
}

export function diffTotals(stored, recount) {
  const diffs = [];
  for (const [k, v] of Object.entries(recount.totals)) if (String(stored.totals[k]) !== String(v)) diffs.push(`${k}: stored ${stored.totals[k]}, recount ${v}`);
  if (stored.parties.length !== recount.parties) diffs.push(`parties: stored ${stored.parties.length}, recount ${recount.parties}`);
  return diffs;
}

async function main() {
  const uptoArg = process.argv.indexOf("--upto");
  if (uptoArg > 0) {
    console.log(JSON.stringify(await recountFromExplorer(BigInt(process.argv[uptoArg + 1])), null, 2));
    return;
  }
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (read-only use), or pass --upto <block>.");
  const { result } = await getJson(`${url}/get/${encodeURIComponent(KEY)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!result) throw new Error(`Nothing stored at ${KEY} yet. Run the backfill first.`);
  const stored = JSON.parse(result);
  const recount = await recountFromExplorer(BigInt(stored.cursorBlock));
  const diffs = diffTotals(stored, recount);
  console.log(`Stored as of ${stored.updatedAt}, cursor block ${stored.cursorBlock} (head ${stored.headBlock}).`);
  console.log("Stored totals:", stored.totals, "parties", stored.parties.length);
  console.log("Recount:      ", recount.totals, "parties", recount.parties);
  if (recount.problems.length) console.log("Recount problems:", recount.problems);
  if (diffs.length || recount.problems.length) { console.log("MISMATCH:\n  " + diffs.join("\n  ")); process.exit(1); }
  console.log("MATCH: every total equals the independent recount.");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
