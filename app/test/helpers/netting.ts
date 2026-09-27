/// Builds real, fully signed netting loops for the Mode B tests: fresh keys per party, both
/// parties' signatures on every obligation, and every party's signature on the certificate.

import { keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { buildCertificate, certificateTypedData, withSignatures, type LoopObligation } from "../../src/netting/certificate";
import { randomBlinding, ZERO_HASH } from "../../src/netting/commitment";
import { obligationTypedData } from "../../src/netting/obligation";
import type { CertificateView, LedgerDomain, NettingObligation } from "../../src/netting/types";

export interface LoopFixture {
  parties: PrivateKeyAccount[];
  loop: LoopObligation[];
}

export async function signedLoop(params: {
  domain: LedgerDomain;
  amounts: bigint[];
  currency?: string;
  parties?: PrivateKeyAccount[];
  maturity?: bigint;
  earlyNetConsent?: boolean;
}): Promise<LoopFixture> {
  const { domain, amounts } = params;
  const n = amounts.length;
  const parties = params.parties ?? amounts.map(() => privateKeyToAccount(generatePrivateKey()));

  const loop = await Promise.all(
    amounts.map(async (amount, i) => {
      const debtor = parties[i]!;
      const creditor = parties[(i + 1) % n]!;
      const obligation: NettingObligation = {
        documentHash: keccak256(toHex(`invoice ${i} ${randomBlinding()}`)),
        debtor: debtor.address,
        creditor: creditor.address,
        currency: params.currency ?? "USD",
        amount,
        maturity: params.maturity ?? 1_700_000_000n,
        earlyNetConsent: params.earlyNetConsent ?? false,
        salt: randomBlinding(),
      };
      const typedData = obligationTypedData(obligation, domain);
      return {
        obligation,
        debtorSignature: await debtor.signTypedData(typedData),
        creditorSignature: await creditor.signTypedData(typedData),
        remaining: amount,
        blinding: ZERO_HASH as Hex,
      };
    }),
  );

  return { parties, loop };
}

/// Every entry's debtor signs, in entry order, as the ledger expects.
export async function signCertificate(view: CertificateView, parties: PrivateKeyAccount[]): Promise<CertificateView> {
  const typedData = certificateTypedData(view.certificate, view.domain);
  const byAddress = new Map(parties.map((p) => [p.address.toLowerCase(), p]));
  const signatures = await Promise.all(
    view.certificate.entries.map((e) => {
      const signer = byAddress.get(e.debtor.toLowerCase());
      if (!signer) throw new Error(`no key for ${e.debtor}`);
      return signer.signTypedData(typedData);
    }),
  );
  return withSignatures(view, signatures);
}

export async function signedCertificate(params: {
  domain: LedgerDomain;
  amounts: bigint[];
  wNet?: bigint;
  maturity?: bigint;
  earlyNetConsent?: boolean;
}): Promise<{ view: CertificateView; fixture: LoopFixture }> {
  const fixture = await signedLoop(params);
  const wNet = params.wNet ?? params.amounts.reduce((a, b) => (a < b ? a : b));
  const unsigned = buildCertificate({
    domain: params.domain,
    currency: "USD",
    wNet,
    deadline: 4_000_000_000n,
    loop: fixture.loop,
  });
  return { view: await signCertificate(unsigned, fixture.parties), fixture };
}
