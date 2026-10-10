/// The netting module against the real compiled `ContraflowNettingLedger` on a local anvil
/// chain: TypeScript hashes must equal the contract's own view functions, and a certificate
/// built and signed entirely in TypeScript must apply onchain and then verify against the chain.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "../src/chain/client";
import { ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import { contraflowNettingLedgerAbi } from "../src/contracts/abi/index";
import { buildCertificate, certificateDigest, viewForParty } from "../src/netting/certificate";
import { obligationId, obligationKey } from "../src/netting/obligation";
import { checkSignature } from "../src/netting/signature";
import type { CertificateView, LedgerDomain } from "../src/netting/types";
import { verifyCertificateView } from "../src/netting/verify";
import { resolveCertificateCheckStage } from "../src/netting/certificateStage";
import { startAnvil, type AnvilInstance } from "./helpers/anvil";
import { deployMockErc1271WalletLocally, deployNettingLedgerLocally } from "./helpers/localDeploy";
import { signCertificate, signedCertificate, signedLoop } from "./helpers/netting";

const PORT = 8911;
const RANDOM_LOOPS = 20;

let anvil: AnvilInstance;
let domain: LedgerDomain;
let submitterKey: Hex;

const publicClient = () => createPublicClient({ chain: arcTestnet, transport: http(anvil.rpcUrl) });

async function nowOnChain(): Promise<bigint> {
  return (await publicClient().getBlock()).timestamp;
}

async function applyOnchain(view: CertificateView): Promise<void> {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(submitterKey),
    chain: arcTestnet,
    transport: http(anvil.rpcUrl),
  });
  const hash = await walletClient.writeContract({
    address: domain.verifyingContract,
    abi: contraflowNettingLedgerAbi,
    functionName: "applyCertificate",
    args: [view.certificate, view.signatures],
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
}

async function stateOf(key: Hex): Promise<Hex> {
  return (await publicClient().readContract({
    address: domain.verifyingContract,
    abi: contraflowNettingLedgerAbi,
    functionName: "stateOf",
    args: [key],
  })) as Hex;
}

function randomAmount(): bigint {
  return BigInt(1 + Math.floor(Math.random() * 1_000_000_000)) * 10n ** BigInt(Math.floor(Math.random() * 12));
}

beforeAll(async () => {
  anvil = await startAnvil(PORT, ARC_TESTNET_CHAIN_ID);
  submitterKey = anvil.privateKeys[1]!;
  const ledger = await deployNettingLedgerLocally({
    rpcUrl: anvil.rpcUrl,
    deployerPrivateKey: anvil.privateKeys[0]!,
    ownerAddress: privateKeyToAccount(anvil.privateKeys[0]!).address,
  });
  domain = { chainId: BigInt(ARC_TESTNET_CHAIN_ID), verifyingContract: ledger };
});

afterAll(() => anvil?.stop());

describe("netting module against the compiled ledger", () => {
  it(`agrees with the contract's hashing across ${RANDOM_LOOPS} random loops`, async () => {
    const client = publicClient();
    for (let run = 0; run < RANDOM_LOOPS; run++) {
      const n = 2 + (run % 4);
      const amounts = Array.from({ length: n }, randomAmount);
      const { view } = await signedCertificate({ domain, amounts });

      for (const [i, entry] of view.certificate.entries.entries()) {
        const held = view.entries[i]!;
        if (held.kind !== "full") throw new Error("expected a full view");
        const onchainId = await client.readContract({
          address: domain.verifyingContract,
          abi: contraflowNettingLedgerAbi,
          functionName: "obligationId",
          args: [held.document.obligation],
        });
        expect(onchainId).toBe(obligationId(held.document.obligation, domain));
        const onchainKey = await client.readContract({
          address: domain.verifyingContract,
          abi: contraflowNettingLedgerAbi,
          functionName: "obligationKey",
          args: [entry.obligationId, entry.debtor, entry.creditor],
        });
        expect(onchainKey).toBe(obligationKey(entry.obligationId, entry.debtor, entry.creditor));
      }

      const onchainDigest = await client.readContract({
        address: domain.verifyingContract,
        abi: contraflowNettingLedgerAbi,
        functionName: "certificateDigest",
        args: [view.certificate],
      });
      expect(onchainDigest).toBe(certificateDigest(view.certificate, domain));
    }
  });

  it("applies a TypeScript-built certificate, then a second one from the new state", async () => {
    const amounts = [700_00n, 450_00n, 900_00n];
    const { view, fixture } = await signedCertificate({ domain, amounts, wNet: 300_00n });

    const before = await verifyCertificateView(view, { now: await nowOnChain(), client: publicClient() });
    expect(before.ok).toBe(true);

    await applyOnchain(view);
    for (const entry of view.certificate.entries) {
      expect(await stateOf(obligationKey(entry.obligationId, entry.debtor, entry.creditor))).toBe(entry.nextCommitment);
    }

    const applied = await verifyCertificateView(view, {
      now: await nowOnChain(),
      stage: "applied",
      client: publicClient(),
    });
    expect(applied.checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(applied.ok).toBe(true);

    // Net the same obligations again, starting from where the first certificate left them.
    const second = buildCertificate({
      domain,
      currency: "USD",
      wNet: 150_00n,
      deadline: 4_000_000_000n,
      loop: fixture.loop.map((item, i) => {
        const held = view.entries[i]!;
        if (held.kind !== "full") throw new Error("expected a full view");
        return { ...item, remaining: held.document.remainingAfter, blinding: held.document.blindingAfter };
      }),
    });
    const secondSigned = await signCertificate(second, fixture.parties);
    await applyOnchain(secondSigned);
    for (const entry of secondSigned.certificate.entries) {
      expect(await stateOf(obligationKey(entry.obligationId, entry.debtor, entry.creditor))).toBe(entry.nextCommitment);
    }

    // The first certificate still verifies as applied, with its entries netted again since.
    const firstAgain = await verifyCertificateView(viewForParty(view, fixture.parties[0]!.address), {
      now: await nowOnChain(),
      stage: "applied",
      client: publicClient(),
    });
    expect(firstAgain.ok).toBe(true);
    expect(firstAgain.checks.find((c) => c.name === "onchain:entry:0:state")?.detail).toBe("Netted again since");
  });

  it("right after an apply, a party's reload checks against the ledger, not a lagging ready row", async () => {
    const { view, fixture } = await signedCertificate({ domain, amounts: [500_00n, 800_00n, 650_00n], wNet: 200_00n });
    await applyOnchain(view);
    const partyView = viewForParty(view, fixture.parties[0]!.address);

    // The database row has not caught up: it still says ready.
    const resolved = await resolveCertificateCheckStage({
      dbStatus: "ready",
      certificateId: view.certificate.certificateId,
      client: publicClient(),
      ledger: domain.verifyingContract,
    });
    expect(resolved).toEqual({ stage: "applied", ledgerApplied: true, syncing: true });

    const atLedgerStage = await verifyCertificateView(partyView, { now: await nowOnChain(), stage: resolved.stage, client: publicClient() });
    expect(atLedgerStage.checks.filter((c) => c.status !== "pass")).toEqual([]);
  });

  it("reports an unapplied certificate as not applied", async () => {
    const { view } = await signedCertificate({ domain, amounts: [100n, 200n] });
    const result = await verifyCertificateView(view, { now: await nowOnChain(), stage: "applied", client: publicClient() });
    expect(result.checks.find((c) => c.name === "onchain:application-event")?.status).toBe("fail");
    expect(result.ok).toBe(false);
  });

  it("with a chain client, fails a wrong EOA signature outright instead of calling it unverifiable", async () => {
    const { view } = await signedCertificate({ domain, amounts: [100n, 200n] });
    const swapped = { ...view, signatures: [view.signatures[1]!, view.signatures[0]!] };
    const result = await verifyCertificateView(swapped, { now: await nowOnChain(), client: publicClient() });
    expect(result.checks.find((c) => c.name === "certificate-signature:0")?.status).toBe("fail");
    expect(result.ok).toBe(false);
  });

  it("refuses to check against a client on a different chain", async () => {
    const { view } = await signedCertificate({ domain, amounts: [100n, 200n] });
    const otherChain = { ...view, domain: { ...domain, chainId: 5042n } };
    const result = await verifyCertificateView(otherChain, { now: await nowOnChain(), client: publicClient() });
    expect(result.checks.find((c) => c.name === "chain")?.status).toBe("fail");
    expect(result.ok).toBe(false);
  });

  it("checks a smart account's ERC-1271 signature onchain, and only onchain", async () => {
    const wallet = await deployMockErc1271WalletLocally({ rpcUrl: anvil.rpcUrl, deployerPrivateKey: anvil.privateKeys[0]! });
    const digest = keccak256(toHex("approved by the smart account"));
    const walletClient = createWalletClient({
      account: privateKeyToAccount(anvil.privateKeys[0]!),
      chain: arcTestnet,
      transport: http(anvil.rpcUrl),
    });
    const hash = await walletClient.writeContract({
      address: wallet.address,
      abi: wallet.abi,
      functionName: "approve",
      args: [digest],
    });
    await publicClient().waitForTransactionReceipt({ hash });

    const anySignature: Hex = "0x1234";
    expect((await checkSignature(wallet.address, digest, anySignature, publicClient())).status).toBe("pass");
    expect((await checkSignature(wallet.address, keccak256(toHex("other")), anySignature, publicClient())).status).toBe(
      "fail",
    );
    expect((await checkSignature(wallet.address, digest, anySignature)).status).toBe("unverifiable");

    const eoa: Address = privateKeyToAccount(generatePrivateKey()).address;
    expect((await checkSignature(eoa, digest, anySignature, publicClient())).status).toBe("fail");
  });

  it("agrees with the contract on a two-party loop built from signedLoop directly", async () => {
    const { loop, parties } = await signedLoop({ domain, amounts: [5n, 9n] });
    const view = await signCertificate(
      buildCertificate({ domain, currency: "USD", wNet: 5n, deadline: 4_000_000_000n, loop }),
      parties,
    );
    await applyOnchain(view);
    const result = await verifyCertificateView(view, { now: await nowOnChain(), stage: "applied", client: publicClient() });
    expect(result.ok).toBe(true);
  });
});
