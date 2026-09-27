/// The certificate service end to end against the real compiled `ContraflowNettingLedger` on a
/// local anvil chain: the real service code (with an in-memory store) finds, proposes and
/// collects signatures; each party's own wallet applies; the database then follows the chain.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, http, keccak256, parseEther, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arcTestnet } from "../src/chain/client";
import { createPhase1ComplianceProvider } from "../src/compliance";
import { ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import { contraflowNettingLedgerAbi } from "../src/contracts/abi/index";
import { certificateTypedData } from "../src/netting/certificate";
import { commitment, randomBlinding, ZERO_HASH } from "../src/netting/commitment";
import { obligationKey, obligationTypedData } from "../src/netting/obligation";
import { parseCertificateView } from "../src/netting/serialize";
import type { CertificateView, LedgerDomain, NettingObligation } from "../src/netting/types";
import { verifyCertificateView } from "../src/netting/verify";
import { createCertificateService, type CertificateService } from "../src/obligations/certificates";
import { startAnvil, type AnvilInstance } from "./helpers/anvil";
import { deployNettingLedgerLocally } from "./helpers/localDeploy";
import { createMemoryCertificateStore, seedObligation, type MemoryCertificateStore } from "./helpers/memoryCertificateStore";
import { signedLoop } from "./helpers/netting";

const PORT = 8912;

let anvil: AnvilInstance;
let domain: LedgerDomain;
let store: MemoryCertificateStore;
let service: CertificateService;

const publicClient = () => createPublicClient({ chain: arcTestnet, transport: http(anvil.rpcUrl) });
const now = () => BigInt(Math.floor(Date.now() / 1000));

beforeAll(async () => {
  anvil = await startAnvil(PORT, ARC_TESTNET_CHAIN_ID);
  const deployer = anvil.privateKeys[0]!;
  const ledger = await deployNettingLedgerLocally({
    rpcUrl: anvil.rpcUrl,
    deployerPrivateKey: deployer,
    ownerAddress: privateKeyToAccount(deployer).address,
  });
  domain = { chainId: BigInt(ARC_TESTNET_CHAIN_ID), verifyingContract: ledger };
  store = createMemoryCertificateStore();
  service = createCertificateService({
    store,
    client: publicClient(),
    domain,
    now,
    complianceProvider: createPhase1ComplianceProvider([]),
    rateLimited: async () => false,
  });
});

afterAll(() => anvil?.stop());

async function fund(address: Address) {
  const testClient = createTestClient({ mode: "anvil", chain: arcTestnet, transport: http(anvil.rpcUrl) });
  await testClient.setBalance({ address, value: parseEther("1") });
}

async function viewFor(party: PrivateKeyAccount, token: string): Promise<CertificateView> {
  const result = await service.getCertificateView(party.address, token);
  if (!result.ok) throw new Error(result.error);
  return parseCertificateView(result.certificate.view);
}

/// Each party checks its own view against the chain before signing, as its browser does.
async function verifyAndSign(token: string, parties: PrivateKeyAccount[]) {
  for (const party of parties) {
    const view = await viewFor(party, token);
    const checked = await verifyCertificateView(view, { now: now(), stage: "proposed", client: publicClient() });
    expect(checked.checks.filter((c) => c.status !== "pass")).toEqual([]);
    const signature = await party.signTypedData(certificateTypedData(view.certificate, view.domain));
    expect(await service.submitCertificateSignature(party.address, token, signature)).toEqual({ ok: true });
  }
}

async function applyFrom(party: PrivateKeyAccount, token: string): Promise<Hex> {
  const view = await viewFor(party, token);
  const wallet = createWalletClient({ account: party, chain: arcTestnet, transport: http(anvil.rpcUrl) });
  const hash = await wallet.writeContract({
    address: domain.verifyingContract,
    abi: contraflowNettingLedgerAbi,
    functionName: "applyCertificate",
    args: [view.certificate, view.signatures as Hex[]],
  });
  expect((await publicClient().waitForTransactionReceipt({ hash })).status).toBe("success");
  return hash;
}

async function onchainState(obligationId: string): Promise<Hex> {
  const row = store.obligations.get(obligationId)!;
  return (await publicClient().readContract({
    address: domain.verifyingContract,
    abi: contraflowNettingLedgerAbi,
    functionName: "stateOf",
    args: [obligationKey(row.obligationId as Hex, row.debtor as Address, row.creditor as Address)],
  })) as Hex;
}

/// The database and the ledger agree on an obligation's state.
async function expectInSync(obligationId: string) {
  const row = store.obligations.get(obligationId)!;
  expect(row.status).toBe("active");
  expect(await onchainState(obligationId)).toBe(commitment(row.obligationId as Hex, BigInt(row.remaining), row.blinding as Hex));
}

async function propose(party: PrivateKeyAccount): Promise<string> {
  const result = await service.findAndProposeLoop(party.address);
  if (!result.ok || !result.outcome.found) throw new Error(JSON.stringify(result));
  return result.outcome.token;
}

describe("netting certificates against the compiled ledger", () => {
  it("finds, signs, applies and follows two loops over the same obligations", async () => {
    const amounts = [700_00n, 450_00n, 900_00n];
    const { parties, loop } = await signedLoop({ domain, amounts, currency: "GHS" });
    const rows = loop.map((item) => seedObligation(store, domain, item));
    for (const p of parties) await fund(p.address);

    // Round one: applied from a party's wallet and recorded through the service.
    const token1 = await propose(parties[0]!);
    await verifyAndSign(token1, parties);
    const hash1 = await applyFrom(parties[1]!, token1);
    expect(await service.recordApplicationTx(parties[1]!.address, token1, hash1)).toEqual({ ok: true, status: "applied" });

    for (const [i, row] of rows.entries()) {
      expect(store.obligations.get(row.obligationId)!.remaining).toBe((amounts[i]! - 450_00n).toString());
      await expectInSync(row.obligationId);
    }
    for (const p of parties) {
      const exported = await service.exportCertificate(p.address, token1);
      if (!exported.ok) throw new Error(exported.error);
      const checked = await verifyCertificateView(parseCertificateView(exported.json), {
        now: now(),
        stage: "applied",
        client: publicClient(),
      });
      expect(checked.checks.filter((c) => c.status !== "pass")).toEqual([]);
    }

    // Round two: a new obligation closes a loop over two of the netted ones, from their new
    // state. Applied directly, outside the service; the listing picks it up from the chain.
    const fresh: NettingObligation = {
      documentHash: keccak256(toHex(`fresh ${randomBlinding()}`)),
      debtor: parties[1]!.address,
      creditor: parties[2]!.address,
      currency: "GHS",
      amount: 100_00n,
      maturity: 1_700_000_000n,
      earlyNetConsent: false,
      salt: randomBlinding(),
    };
    const typed = obligationTypedData(fresh, domain);
    const freshRow = seedObligation(store, domain, {
      obligation: fresh,
      debtorSignature: await parties[1]!.signTypedData(typed),
      creditorSignature: await parties[2]!.signTypedData(typed),
      remaining: fresh.amount,
      blinding: ZERO_HASH,
    });

    const token2 = await propose(parties[2]!);
    const second = [...store.certificates.values()].find((c) => c.token === token2)!;
    expect(new Set(second.entries.map((e) => e.obligationId))).toEqual(
      new Set([rows[0]!.obligationId, freshRow.obligationId, rows[2]!.obligationId]),
    );
    await verifyAndSign(token2, parties);
    await applyFrom(parties[0]!, token2);

    const listed = await service.listCertificates(parties[0]!.address);
    expect(listed.ok && listed.certificates.find((c) => c.token === token2)).toMatchObject({ status: "applied", appliedTxHash: null });
    expect(store.obligations.get(rows[0]!.obligationId)!.remaining).toBe((700_00n - 450_00n - 100_00n).toString());
    expect(store.obligations.get(freshRow.obligationId)!.remaining).toBe("0");
    expect(store.obligations.get(rows[2]!.obligationId)!.remaining).toBe((900_00n - 450_00n - 100_00n).toString());
    for (const id of [rows[0]!.obligationId, freshRow.obligationId, rows[2]!.obligationId]) await expectInSync(id);
  });

  it("refuses a stranger's key and a stale certificate at the ledger, changing nothing", async () => {
    const outsider = privateKeyToAccount(generatePrivateKey());
    const { parties, loop } = await signedLoop({ domain, amounts: [300n, 300n] });
    const rows = loop.map((item) => seedObligation(store, domain, item));
    await fund(parties[0]!.address);

    const token = await propose(parties[0]!);
    const view = await viewFor(parties[0]!, token);
    const forged = await outsider.signTypedData(certificateTypedData(view.certificate, domain));
    expect(await service.submitCertificateSignature(parties[0]!.address, token, forged)).toMatchObject({ ok: false });

    await verifyAndSign(token, parties);
    await applyFrom(parties[0]!, token);
    // Replaying it reverts onchain; the database was already synced once and doesn't move again.
    await expect(applyFrom(parties[0]!, token)).rejects.toThrow();
    await service.listCertificates(parties[0]!.address);
    for (const row of rows) {
      expect(store.obligations.get(row.obligationId)!.remaining).toBe("0");
      await expectInSync(row.obligationId);
    }
  });
});
