/// Finding and proposing a netting loop for one party: search its neighbourhood, reconcile
/// every obligation in the chosen loop against the ledger (a mismatch is marked out of sync and
/// the search runs again without it), re-check each stored row against its own signatures,
/// build the certificate, verify it as its parties will, and store it with its obligations
/// locked.

import { isAddressEqual, type Address, type Hex } from "viem";
import { screenAddresses } from "../compliance";
import { contraflowNettingLedgerAbi } from "../contracts/abi/index";
import type { ObligationRow } from "../db/obligations";
import { MAX_LOOP_LENGTH } from "../netting/domain";
import { buildCertificate, priorCommitmentOf, type LoopObligation } from "../netting/certificate";
import { obligationId, obligationKey } from "../netting/obligation";
import { serializeCertificateView } from "../netting/serialize";
import { checkSignature } from "../netting/signature";
import type { NettingObligation } from "../netting/types";
import { verifyCertificateView } from "../netting/verify";
import type { CertificateServiceDeps } from "./certificates";
import { findBestLoop, neighbourhoodParties, type CandidateObligation } from "./loopSearch";
import { newShareToken } from "../share/shareToken";
import type { Result } from "./service";

export const CERTIFICATE_LIFETIME_SECONDS = 7n * 24n * 60n * 60n;
const MAX_CANDIDATES = 2000;
const CANDIDATE_PAGE_SIZE = 100;
const MAX_SEARCH_QUERIES = 128;
const MAX_QUERY_PARTIES = 64;
/// Every vertex on a cycle of at most five edges is within two undirected hops of its caller.
const SEARCH_NEIGHBOURHOOD_DEPTH = Math.floor(MAX_LOOP_LENGTH / 2);
const MAX_SEARCH_ATTEMPTS = 3;

export type SearchOutcome =
  | { found: true; token: string; currency: string; wNet: string; parties: number }
  | { found: false; reason: "no-candidates" | "no-loop" | "too-many-parties" | "search-incomplete" | "out-of-sync"; message: string };

export function obligationFromRow(row: ObligationRow): NettingObligation {
  return {
    documentHash: row.documentHash as Hex,
    debtor: row.debtor as Address,
    creditor: row.creditor as Address,
    currency: row.currency,
    amount: BigInt(row.amount),
    maturity: BigInt(row.maturity),
    earlyNetConsent: row.earlyNetConsent,
    salt: row.salt as Hex,
  };
}

function candidateFromRow(row: ObligationRow): CandidateObligation {
  return {
    obligationId: row.obligationId as Hex,
    debtor: row.debtor as Address,
    creditor: row.creditor as Address,
    currency: row.currency,
    remaining: BigInt(row.remaining),
    maturity: BigInt(row.maturity),
    earlyNetConsent: row.earlyNetConsent,
  };
}

export async function readStateOf(
  { client, domain }: Pick<CertificateServiceDeps, "client" | "domain">,
  id: Hex,
  debtor: Address,
  creditor: Address,
): Promise<Hex> {
  return (await client.readContract({
    address: domain.verifyingContract,
    abi: contraflowNettingLedgerAbi,
    functionName: "stateOf",
    args: [obligationKey(id, debtor, creditor)],
  })) as Hex;
}

type CandidateLoad =
  | { complete: true; rows: ObligationRow[] }
  | { complete: false; cap: "rows" | "queries" | "parties" };

/// Page active, currently nettable rows outward from the caller, keeping each currency's graph
/// separate. The row budget counts database results, including an obligation found from both of
/// its endpoints, so it also bounds repeated work rather than only retained unique rows.
async function loadCallerNeighbourhood(
  store: CertificateServiceDeps["store"],
  session: Address,
  chainId: string,
  ledger: string,
  now: bigint,
): Promise<CandidateLoad> {
  let frontier = new Map<string | undefined, Set<Address>>([[undefined, new Set([session.toLowerCase() as Address])]]);
  const visited = new Map<string, Set<string>>();
  const rowsById = new Map<string, ObligationRow>();
  let scanned = 0;
  let queries = 0;

  for (let depth = 0; depth <= SEARCH_NEIGHBOURHOOD_DEPTH && frontier.size > 0; depth++) {
    const following = new Map<string, Set<Address>>();
    for (const [currency, parties] of frontier) {
      if (parties.size === 0) continue;
      if (parties.size > MAX_QUERY_PARTIES) return { complete: false, cap: "parties" };
      let afterObligationId: string | undefined;
      while (true) {
        const remaining = MAX_CANDIDATES - scanned;
        if (remaining <= 0) return { complete: false, cap: "rows" };
        if (queries >= MAX_SEARCH_QUERIES) return { complete: false, cap: "queries" };
        const limit = Math.min(CANDIDATE_PAGE_SIZE, remaining);
        queries++;
        const page = await store.listNettableObligationsForParties({
          chainId,
          ledger,
          parties: [...parties],
          ...(currency === undefined ? {} : { currency }),
          ...(afterObligationId === undefined ? {} : { afterObligationId }),
          now,
          limit,
        });
        scanned += page.length;
        if (scanned >= MAX_CANDIDATES && page.length === limit) return { complete: false, cap: "rows" };

        for (const row of page) {
          rowsById.set(row.obligationId.toLowerCase(), row);
          if (depth >= SEARCH_NEIGHBOURHOOD_DEPTH) continue;
          let currencyVisited = visited.get(row.currency);
          if (!currencyVisited) {
            currencyVisited = new Set([session.toLowerCase()]);
            visited.set(row.currency, currencyVisited);
          }
          let nextParties = following.get(row.currency);
          if (!nextParties) {
            nextParties = new Set();
            following.set(row.currency, nextParties);
          }
          for (const address of [row.debtor, row.creditor]) {
            const normalized = address.toLowerCase();
            if (!currencyVisited.has(normalized)) {
              currencyVisited.add(normalized);
              nextParties.add(address as Address);
            }
          }
        }

        if (page.length < limit) break;
        afterObligationId = page[page.length - 1]!.obligationId;
      }
    }
    frontier = following;
  }
  const rows = [...rowsById.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.obligationId.localeCompare(b.obligationId),
  );
  return { complete: true, rows };
}

/// A stored obligation as a loop member, or `null` if the row no longer matches the terms and
/// signatures it was recorded with.
async function verifiedLoopObligation(
  { client, domain }: Pick<CertificateServiceDeps, "client" | "domain">,
  row: ObligationRow,
): Promise<LoopObligation | null> {
  const obligation = obligationFromRow(row);
  if (obligationId(obligation, domain) !== row.obligationId.toLowerCase()) return null;
  for (const [signer, signature] of [
    [obligation.debtor, row.debtorSignature],
    [obligation.creditor, row.creditorSignature],
  ] as const) {
    const check = await checkSignature(signer, row.obligationId as Hex, signature as Hex, client);
    if (check.status !== "pass") return null;
  }
  return {
    obligation,
    debtorSignature: row.debtorSignature as Hex,
    creditorSignature: row.creditorSignature as Hex,
    remaining: BigInt(row.remaining),
    blinding: row.blinding as Hex,
  };
}

export async function findAndProposeLoop(
  deps: CertificateServiceDeps,
  session: Address,
): Promise<Result<{ outcome: SearchOutcome }>> {
  const { store, client, domain } = deps;
  const chainId = domain.chainId.toString();
  const ledger = domain.verifyingContract.toLowerCase();
  if (await deps.rateLimited("find", session)) return { ok: false, error: "Too many requests. Try again shortly." };
  const now = deps.now();

  const loaded = await loadCallerNeighbourhood(store, session, chainId, ledger, now);
  if (!loaded.complete) {
    console.error(`findAndProposeLoop: caller-local ${loaded.cap} work cap reached; not searching a partial graph`);
    return none("search-incomplete");
  }
  const rows = loaded.rows;
  const byId = new Map(rows.map((r) => [r.obligationId.toLowerCase(), r]));
  const excluded = new Set<string>();
  let sawOutOfSync = false;

  for (let attempt = 0; attempt < MAX_SEARCH_ATTEMPTS; attempt++) {
    const candidates = rows.filter((r) => !excluded.has(r.obligationId.toLowerCase())).map(candidateFromRow);
    const mine = candidates.filter((c) => isAddressEqual(c.debtor, session) || isAddressEqual(c.creditor, session));
    if (mine.length === 0) return none(sawOutOfSync ? "out-of-sync" : "no-candidates");

    const screened = await screenAddresses([...neighbourhoodParties(candidates, session, now)], deps.complianceProvider);
    const flagged = new Set(screened.filter((s) => s.status !== "clear").map((s) => s.address.toLowerCase() as Address));
    const search = findBestLoop(candidates, session, { now, excludedParties: flagged });
    if (search.kind === "none") return none(sawOutOfSync ? "out-of-sync" : "no-loop");
    if (search.kind === "too-many-parties") {
      console.error(`findAndProposeLoop: ${search.parties} parties near ${session} in ${search.currency}; not searching`);
      return none("too-many-parties");
    }
    if (search.kind === "search-incomplete") {
      console.error(`findAndProposeLoop: cycle cap ${search.maxCycles} reached for ${search.currency}; not proposing from a partial search`);
      return none("search-incomplete");
    }

    // Reconcile against the ledger, and re-check each row against its own signatures.
    const loop: LoopObligation[] = [];
    let stale = false;
    for (const candidate of search.loop) {
      const row = byId.get(candidate.obligationId.toLowerCase())!;
      const current = await readStateOf(deps, row.obligationId as Hex, row.debtor as Address, row.creditor as Address);
      const expected = priorCommitmentOf(row.obligationId as Hex, BigInt(row.remaining), row.blinding as Hex);
      if (current.toLowerCase() !== expected) {
        console.error(`findAndProposeLoop: obligation ${row.obligationId} disagrees with the ledger; marking out of sync`);
        await store.markObligationOutOfSync(row.obligationId, { remaining: row.remaining, blinding: row.blinding });
        excluded.add(row.obligationId.toLowerCase());
        sawOutOfSync = stale = true;
        continue;
      }
      const member = await verifiedLoopObligation(deps, row);
      if (!member) {
        console.error(`findAndProposeLoop: obligation ${row.obligationId} fails its own signatures; excluding it`);
        excluded.add(row.obligationId.toLowerCase());
        stale = true;
        continue;
      }
      loop.push(member);
    }
    if (stale) continue;

    const view = buildCertificate({
      domain,
      currency: search.currency,
      wNet: search.wNet,
      deadline: now + CERTIFICATE_LIFETIME_SECONDS,
      loop,
    });
    const self = await verifyCertificateView(view, { now, stage: "proposed", client });
    if (!self.ok) {
      const failed = self.checks.filter((c) => c.status !== "pass").map((c) => c.name);
      throw new Error(`findAndProposeLoop: built a certificate that fails its own checks: ${failed.join(", ")}`);
    }

    const token = (deps.newToken ?? newShareToken)();
    const inserted = await store.insertCertificate({
      certificateId: view.certificate.certificateId,
      token,
      chainId,
      ledger,
      currency: view.currency,
      wNet: view.wNet.toString(),
      deadline: view.certificate.deadline.toString(),
      contentHash: view.certificate.contentHash,
      fullView: JSON.parse(serializeCertificateView(view)),
      proposedBy: session,
      entries: loop.map((l) => ({
        obligationId: obligationId(l.obligation, domain),
        debtor: l.obligation.debtor,
        creditor: l.obligation.creditor,
        remaining: l.remaining.toString(),
        blinding: l.blinding,
      })),
    });
    if (inserted === "locked") {
      return { ok: false, error: "One of these obligations was just included in another certificate. Try again." };
    }
    if (inserted === "changed") return { ok: false, error: "One of these obligations just changed. Try again." };
    return {
      ok: true,
      outcome: { found: true, token, currency: view.currency, wNet: view.wNet.toString(), parties: loop.length },
    };
  }
  return none("out-of-sync");
}

function none(reason: Extract<SearchOutcome, { found: false }>["reason"]): Result<{ outcome: SearchOutcome }> {
  const message = {
    "no-candidates": "None of your obligations can be netted right now.",
    "no-loop": "No loop of obligations runs through you right now.",
    "too-many-parties": "Too many parties are connected to you to search safely. Nothing was proposed.",
    "search-incomplete": "The obligation search reached its safety limit. No partial result was proposed; narrow the search and try again.",
    "out-of-sync": "Some obligations disagree with the ledger, so they were left out. No other loop runs through you right now.",
  }[reason];
  return { ok: true, outcome: { found: false, reason, message } };
}
