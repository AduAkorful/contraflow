/// Server-side netting certificates behind `/app/obligations` and `/app/c/<token>`: find a loop
/// for the caller, propose it, collect every party's signature, follow the ledger once it's
/// applied, and export each party's view.
///
/// As with proposals, every function takes the caller's address from the verified session, and
/// anyone who isn't a party gets "Not found". Two rules hold throughout:
/// - parties only ever receive `viewForParty`, never the full view with everyone's amounts;
/// - the database follows the ledger, never the reverse: an obligation's stored state advances
///   only in `syncRow`, after the ledger says the certificate was applied.
///
/// Dependencies are injected so the same code runs in unit tests, against anvil, and live.

import { decodeEventLog, isAddressEqual, isHex, size, type Address, type Hex, type PublicClient } from "viem";
import type { ComplianceProvider } from "../compliance";
import { contraflowNettingLedgerAbi } from "../contracts/abi/index";
import { certificateDigest, viewForParty } from "../netting/certificate";
import { parseCertificateView, serializeCertificateView } from "../netting/serialize";
import { checkSignature, type ChainReader } from "../netting/signature";
import type { CertificateView, LedgerDomain } from "../netting/types";
import type { CertificateRow, CertificateStatus, CertificateStore } from "./certificateStore";
import { OPEN_CERTIFICATE_STATUSES } from "./certificateStore";
import { findAndProposeLoop, readStateOf } from "./proposeLoop";
import { isShareToken } from "../share/shareToken";
import type { Result } from "./service";

export { CERTIFICATE_LIFETIME_SECONDS, type SearchOutcome } from "./proposeLoop";

/// Chain time can trail the server clock, so a certificate is only marked expired once it's
/// clearly past its deadline onchain too.
const EXPIRY_GRACE_SECONDS = 60n * 60n;
const MAX_SYNCS_PER_LIST = 10;
const NOT_FOUND = "Not found.";
const RATE_LIMITED = "Too many requests. Try again shortly.";

export interface CertificateServiceDeps {
  store: CertificateStore;
  client: ChainReader & Pick<PublicClient, "getTransactionReceipt">;
  domain: LedgerDomain;
  /// Unix seconds.
  now: () => bigint;
  complianceProvider: ComplianceProvider;
  /// `true` when the caller is over its limit for this kind of request.
  rateLimited: (kind: "find" | "read" | "write", address: Address) => Promise<boolean>;
  newToken?: () => string;
}

/// What a party sees of a certificate. `view` is `serializeCertificateView` of its own view.
export interface PartyCertificate {
  token: string;
  status: CertificateStatus;
  currency: string;
  wNet: string;
  deadline: string;
  parties: number;
  signedCount: number;
  yourIndex: number;
  youSigned: boolean;
  appliedTxHash: string | null;
  view: string;
}

export interface CertificateSummary {
  token: string;
  status: CertificateStatus;
  currency: string;
  wNet: string;
  deadline: string;
  parties: number;
  signedCount: number;
  youSigned: boolean;
  appliedTxHash: string | null;
}

function isParty(row: CertificateRow, address: Address): boolean {
  return row.entries.some((e) => isAddressEqual(e.debtor as Address, address) || isAddressEqual(e.creditor as Address, address));
}

/// The stored full view with the signatures collected so far.
function fullViewOf(row: CertificateRow): CertificateView {
  const view = parseCertificateView(JSON.stringify(row.fullView));
  const signatures = view.certificate.entries.map((_, i) => (row.signatures.find((s) => s.idx === i)?.signature ?? null) as Hex | null);
  return { ...view, signatures };
}

export function createCertificateService(deps: CertificateServiceDeps) {
  const { store, client, domain } = deps;
  const chainId = domain.chainId.toString();
  const ledger = domain.verifyingContract.toLowerCase();

  const onThisLedger = (row: CertificateRow) => row.chainId === chainId && row.ledger === ledger;

  /// Moves the database toward the ledger for one open certificate. No session needed: it only
  /// reads the chain. Returns the row as it now stands.
  async function syncRow(row: CertificateRow): Promise<CertificateRow> {
    if (!OPEN_CERTIFICATE_STATUSES.includes(row.status) || !onThisLedger(row)) return row;

    const applied = (await client.readContract({
      address: domain.verifyingContract,
      abi: contraflowNettingLedgerAbi,
      functionName: "isApplied",
      args: [row.certificateId as Hex],
    })) as boolean;

    if (applied) {
      const view = fullViewOf(row);
      const entries = [];
      for (let i = 0; i < view.entries.length; i++) {
        const held = view.entries[i]!;
        if (held.kind !== "full") throw new Error(`syncCertificate: stored view for ${row.certificateId} is not a full view`);
        const entry = view.certificate.entries[i]!;
        const current = await readStateOf(deps, entry.obligationId, entry.debtor, entry.creditor);
        entries.push({
          obligationId: entry.obligationId,
          before: { remaining: held.document.remainingBefore.toString(), blinding: held.document.blindingBefore },
          after: { remaining: held.document.remainingAfter.toString(), blinding: held.document.blindingAfter },
          // A later certificate's prior must equal this one's next, so anything else means the
          // ledger was advanced again by a certificate this database never saw.
          movedOn: current.toLowerCase() !== entry.nextCommitment.toLowerCase(),
        });
      }
      await store.finalizeApplied({ certificateId: row.certificateId, txHash: row.appliedTxHash, entries });
    } else if (deps.now() > BigInt(row.deadline) + EXPIRY_GRACE_SECONDS) {
      await store.expireCertificate(row.certificateId);
    } else {
      return row;
    }
    return (await store.getCertificateById(row.certificateId)) ?? row;
  }

  async function syncCertificate(certificateId: Hex): Promise<CertificateStatus | null> {
    const row = await store.getCertificateById(certificateId);
    return row ? (await syncRow(row)).status : null;
  }

  /// The certificate behind a token, for one of its parties, brought up to date with the ledger.
  async function partyRow(session: Address, token: unknown, kind: "read" | "write"): Promise<Result<{ row: CertificateRow }>> {
    if (!isShareToken(token)) return { ok: false, error: NOT_FOUND };
    if (await deps.rateLimited(kind, session)) return { ok: false, error: RATE_LIMITED };
    const row = await store.getCertificateByToken(token);
    if (!row || !onThisLedger(row) || !isParty(row, session)) return { ok: false, error: NOT_FOUND };
    return { ok: true, row: await syncRow(row) };
  }

  async function getCertificateView(session: Address, token: unknown): Promise<Result<{ certificate: PartyCertificate }>> {
    const found = await partyRow(session, token, "read");
    if (!found.ok) return found;
    const { row } = found;
    const yourIndex = row.entries.findIndex((e) => isAddressEqual(e.debtor as Address, session));
    return {
      ok: true,
      certificate: {
        token: row.token,
        status: row.status,
        currency: row.currency,
        wNet: row.wNet,
        deadline: row.deadline,
        parties: row.entries.length,
        signedCount: row.signatures.length,
        yourIndex,
        youSigned: row.signatures.some((s) => s.idx === yourIndex),
        appliedTxHash: row.appliedTxHash,
        view: serializeCertificateView(viewForParty(fullViewOf(row), session)),
      },
    };
  }

  /// A party's signature over the certificate. Each party signs only for the entry where it's
  /// the debtor, and the signature must check out against the chain before it's stored.
  async function submitCertificateSignature(session: Address, token: unknown, signature: unknown): Promise<Result> {
    if (typeof signature !== "string" || !isHex(signature)) return { ok: false, error: "Invalid signature." };
    const found = await partyRow(session, token, "write");
    if (!found.ok) return found;
    const { row } = found;
    const idx = row.entries.findIndex((e) => isAddressEqual(e.debtor as Address, session));
    if (idx < 0) return { ok: false, error: NOT_FOUND };
    if (row.signatures.some((s) => s.idx === idx)) return { ok: true };
    if (row.status !== "collecting") return { ok: false, error: "This certificate is no longer collecting signatures." };
    if (deps.now() >= BigInt(row.deadline)) return { ok: false, error: "This certificate has expired." };

    const view = fullViewOf(row);
    const check = await checkSignature(session, certificateDigest(view.certificate, view.domain), signature as Hex, client);
    if (check.status !== "pass") return { ok: false, error: "That signature isn't valid for this certificate." };

    const stored = await store.addSignature({
      certificateId: row.certificateId,
      idx,
      signer: session,
      signature,
      required: row.entries.length,
    });
    if (stored === "stored" || stored === "already_present") return { ok: true };
    if (stored === "expired") return { ok: false, error: "This certificate has expired." };
    if (stored === "missing") return { ok: false, error: NOT_FOUND };
    return { ok: false, error: "This certificate just changed. Reload and try again." };
  }

  async function declineCertificate(session: Address, token: unknown): Promise<Result> {
    const found = await partyRow(session, token, "write");
    if (!found.ok) return found;
    const { row } = found;
    if (row.status === "abandoned") return { ok: true };
    if (row.status === "ready") {
      return { ok: false, error: "Every party has signed, so it can no longer be declined. Anyone in the loop can apply it." };
    }
    if (row.status !== "collecting") return { ok: false, error: "This certificate is closed." };
    const abandoned = await store.abandonCertificate(row.certificateId, "declined");
    return abandoned ? { ok: true } : { ok: false, error: "This certificate just changed. Reload and try again." };
  }

  /// Records the transaction that applied a certificate, for the receipt link. The hash proves
  /// nothing by itself: its receipt must carry the ledger's `CertificateApplied` event for exactly
  /// this certificate and content hash.
  async function recordApplicationTx(session: Address, token: unknown, txHash: unknown): Promise<Result<{ status: CertificateStatus }>> {
    if (typeof txHash !== "string" || !isHex(txHash) || size(txHash) !== 32) return { ok: false, error: "Invalid transaction." };
    const found = await partyRow(session, token, "write");
    if (!found.ok) return found;
    const { row } = found;

    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch {
      return { ok: false, error: "That transaction isn't confirmed yet." };
    }
    // The ledger's own event is the proof. The transaction itself may be to a smart account
    // that called the ledger, so its `to` isn't checked.
    const appliedHere =
      receipt.status === "success" &&
      receipt.logs.some((log) => {
        if (!isAddressEqual(log.address, domain.verifyingContract)) return false;
        try {
          const event = decodeEventLog({ abi: contraflowNettingLedgerAbi, data: log.data, topics: log.topics });
          if (event.eventName !== "CertificateApplied") return false;
          const args = event.args as unknown as { certificateId: Hex; contentHash: Hex };
          return args.certificateId.toLowerCase() === row.certificateId && args.contentHash.toLowerCase() === row.contentHash;
        } catch {
          return false;
        }
      });
    if (!appliedHere) return { ok: false, error: "That transaction didn't apply this certificate." };

    await store.setAppliedTxHash(row.certificateId, txHash);
    const synced = await syncRow({ ...row, appliedTxHash: row.appliedTxHash ?? txHash.toLowerCase() });
    return { ok: true, status: synced.status };
  }

  /// The party's own view with every signature: enough to verify it later, and to keep netting
  /// from the new state without Contraflow.
  async function exportCertificate(session: Address, token: unknown): Promise<Result<{ json: string; fileName: string }>> {
    const found = await partyRow(session, token, "read");
    if (!found.ok) return found;
    const { row } = found;
    if (row.status !== "ready" && row.status !== "applied") {
      return { ok: false, error: "A certificate can be downloaded once every party has signed it." };
    }
    return {
      ok: true,
      json: serializeCertificateView(viewForParty(fullViewOf(row), session)),
      fileName: `contraflow-certificate-${row.certificateId.slice(2, 10)}.json`,
    };
  }

  /// Stops an obligation being netted in future. Either party can do it alone. While it's in a
  /// certificate still collecting signatures, that certificate is abandoned; once every party
  /// has signed one, anyone holding the signatures could apply it, so closing is refused.
  async function closeObligation(session: Address, id: unknown): Promise<Result> {
    if (typeof id !== "string" || !isHex(id)) return { ok: false, error: NOT_FOUND };
    if (await deps.rateLimited("write", session)) return { ok: false, error: RATE_LIMITED };
    const row = await store.getObligationById(id);
    if (!row) return { ok: false, error: NOT_FOUND };
    if (!isAddressEqual(session, row.debtor as Address) && !isAddressEqual(session, row.creditor as Address)) {
      return { ok: false, error: NOT_FOUND };
    }
    const result = await store.closeObligation(id, session);
    return result === "closed"
      ? { ok: true }
      : {
          ok: false,
          error: "This obligation is in a certificate every party has signed. It can be closed once that's applied or expires.",
        };
  }

  async function listCertificates(session: Address): Promise<Result<{ certificates: CertificateSummary[] }>> {
    if (await deps.rateLimited("read", session)) return { ok: false, error: RATE_LIMITED };
    const rows = (await store.listCertificatesForParty(session)).filter(onThisLedger);
    let syncs = 0;
    const current: CertificateRow[] = [];
    for (const row of rows) {
      if (OPEN_CERTIFICATE_STATUSES.includes(row.status) && syncs < MAX_SYNCS_PER_LIST) {
        syncs++;
        current.push(await syncRow(row));
      } else {
        current.push(row);
      }
    }
    return {
      ok: true,
      certificates: current.map((row) => {
        const yourIndex = row.entries.findIndex((e) => isAddressEqual(e.debtor as Address, session));
        return {
          token: row.token,
          status: row.status,
          currency: row.currency,
          wNet: row.wNet,
          deadline: row.deadline,
          parties: row.entries.length,
          signedCount: row.signatures.length,
          youSigned: row.signatures.some((s) => s.idx === yourIndex),
          appliedTxHash: row.appliedTxHash,
        };
      }),
    };
  }

  return {
    findAndProposeLoop: (session: Address) => findAndProposeLoop(deps, session),
    getCertificateView,
    submitCertificateSignature,
    declineCertificate,
    syncCertificate,
    recordApplicationTx,
    exportCertificate,
    closeObligation,
    listCertificates,
  };
}

export type CertificateService = ReturnType<typeof createCertificateService>;
