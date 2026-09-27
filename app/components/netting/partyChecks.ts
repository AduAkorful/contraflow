/// What a party's browser checks on a certificate before acting on it, independent of what
/// Contraflow's server says: the full standalone verifier, that the party's own two obligations
/// are held in full, and (until it's applied) that the ledger still holds the state each of them
/// starts from.

import { isAddressEqual, type Address, type Hex } from "viem";
import { contraflowNettingLedgerAbi } from "../../src/contracts/abi/index";
import { obligationKey } from "../../src/netting/obligation";
import type { ChainReader } from "../../src/netting/signature";
import type { CertificateView } from "../../src/netting/types";
import { verifyCertificateView, type VerificationResult, type VerificationStage } from "../../src/netting/verify";

export async function checkAsParty(
  view: CertificateView,
  me: Address,
  client: ChainReader | undefined,
  stage: VerificationStage,
): Promise<VerificationResult> {
  const result = await verifyCertificateView(view, { now: BigInt(Math.floor(Date.now() / 1000)), stage, client });
  const checks = [...result.checks];

  let ownFull = true;
  const own: number[] = [];
  view.certificate.entries.forEach((e, i) => {
    if (!isAddressEqual(e.debtor, me) && !isAddressEqual(e.creditor, me)) return;
    own.push(i);
    if (view.entries[i]?.kind !== "full") ownFull = false;
  });
  checks.push({
    name: "view.own-entries",
    status: own.length === 2 && ownFull ? "pass" : "fail",
    detail: `${own.length} of your obligations are in this loop`,
  });

  if (stage !== "applied") {
    if (!client) {
      checks.push({ name: "ledger:current", status: "unverifiable", detail: "No connection to the ledger" });
    } else {
      let current = true;
      for (const i of own) {
        const e = view.certificate.entries[i]!;
        const state = (await client.readContract({
          address: view.domain.verifyingContract,
          abi: contraflowNettingLedgerAbi,
          functionName: "stateOf",
          args: [obligationKey(e.obligationId, e.debtor, e.creditor)],
        })) as Hex;
        if (state.toLowerCase() !== e.priorCommitment.toLowerCase()) current = false;
      }
      checks.push({ name: "ledger:current", status: current ? "pass" : "fail" });
    }
  }

  return { ok: checks.every((c) => c.status === "pass"), checks };
}
