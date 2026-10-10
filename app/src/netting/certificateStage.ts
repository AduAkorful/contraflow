import type { Address, Hex } from "viem";
import { contraflowNettingLedgerAbi } from "../contracts/abi/index";
import type { ChainReader } from "./signature";
import type { VerificationStage } from "./verify";

export type CertificateDbStatus = "collecting" | "ready" | "applied" | "expired" | "abandoned";

export interface CertificateStageResolution {
  /// What the browser verifier should require.
  stage: VerificationStage;
  ledgerApplied: boolean;
  /// The ledger has applied it but the database row hasn't caught up yet.
  syncing: boolean;
}

/// Prefer the ledger over the database. After apply, a lagging `ready` row would otherwise run the
/// "ledger state is current" check against the pre-apply commitments and show a false failure.
/// The ledger stores only an applied flag per certificate ID. The content hash is matched at the
/// `applied` stage itself: the verifier requires a `CertificateApplied` event carrying this
/// certificate's ID and content hash, so an ID applied with other contents fails there.
export async function resolveCertificateCheckStage(params: {
  dbStatus: CertificateDbStatus;
  certificateId: Hex;
  client: ChainReader | undefined;
  ledger: Address;
}): Promise<CertificateStageResolution> {
  let ledgerApplied = false;
  if (params.client && (params.dbStatus === "collecting" || params.dbStatus === "ready" || params.dbStatus === "applied")) {
    try {
      ledgerApplied = (await params.client.readContract({
        address: params.ledger,
        abi: contraflowNettingLedgerAbi,
        functionName: "isApplied",
        args: [params.certificateId],
      })) as boolean;
    } catch {
      ledgerApplied = false;
    }
  }

  if (ledgerApplied || params.dbStatus === "applied") {
    return {
      stage: "applied",
      ledgerApplied: true,
      syncing: ledgerApplied && params.dbStatus !== "applied",
    };
  }
  if (params.dbStatus === "ready") {
    return { stage: "signed", ledgerApplied: false, syncing: false };
  }
  return { stage: "proposed", ledgerApplied: false, syncing: false };
}

export function dbStatusToStage(status: CertificateDbStatus): VerificationStage {
  if (status === "applied") return "applied";
  if (status === "ready") return "signed";
  return "proposed";
}
