/// Full-pipeline integration test: real compiled contracts, deployed to a local anvil instance,
/// driven through the exact same `lib/` functions the app will eventually wire into UI —
/// register the 3 fixture invoices (real EIP-712 signatures, server-side), propose + submit a
/// real `settle()`, read the result back.
///
/// This is the one test in this package that can actually prove the TS-side EIP-712 domain/type
/// (`attest/signAttestation.ts`) matches `ContraflowRegistry.sol`'s `_hashTypedDataV4` exactly —
/// a self-consistency check against viem's own recover function (see `signAttestation.test.ts`)
/// cannot catch a domain/type mismatch against the *actual Solidity hash*, only against itself.
/// Here, a successful `register()` (the contract recovering the right signer from our signature)
/// plus a successful `getInvoice(id)` read using our own client-side-computed id together prove
/// the two implementations agree, not just that ours is internally consistent.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { startAnvil, type AnvilInstance } from "./helpers/anvil";
import { deployContraflowLocally, type LocalDeployment } from "./helpers/localDeploy";
import { createArcPublicClient, createArcWalletClient } from "../src/chain/client";
import { ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import { registerFixtureInvoices } from "../src/actions/register";
import { proposeSettlement, settleBestCycle } from "../src/actions/settle";
import { computeDashboardTiles } from "../src/receipt/dashboardTiles";
import { getInvoice, InvoiceStatus } from "../src/chain/readInvoices";
import { runSettlementPipeline, type PendingInvoice } from "../src/actions/pipeline";
import type { OperatorSigner } from "../src/operator/signer";
import type { PublicClient, Hex } from "viem";

const PORT = 8899;

describe("full pipeline: fixture register -> propose -> settle (local anvil)", () => {
  let anvil: AnvilInstance;
  let deployment: LocalDeployment;
  let publicClient: PublicClient;

  beforeAll(async () => {
    anvil = await startAnvil(PORT, ARC_TESTNET_CHAIN_ID);
    const [deployerKey, northwindKey, meridianKey, atlasKey] = anvil.privateKeys;
    if (!deployerKey || !northwindKey || !meridianKey || !atlasKey) {
      throw new Error("anvil did not report enough test accounts");
    }

    const deployerAddress = privateKeyToAccount(deployerKey).address;
    deployment = await deployContraflowLocally({
      rpcUrl: anvil.rpcUrl,
      deployerPrivateKey: deployerKey,
      ownerAddress: deployerAddress,
      usdcPlaceholder: deployerAddress, // inert on a local chain — never called by register()/settle()
    });

    publicClient = createArcPublicClient(ARC_TESTNET_CHAIN_ID, anvil.rpcUrl) as PublicClient;
  }, 20_000);

  afterAll(() => {
    anvil?.stop();
  });

  it("registers, proposes, and settles the 3-invoice ads fixture end to end", async () => {
    const [deployerKey, northwindKey, meridianKey, atlasKey] = anvil.privateKeys as [
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
      ...`0x${string}`[],
    ];
    const walletClient = createArcWalletClient(ARC_TESTNET_CHAIN_ID, deployerKey, anvil.rpcUrl);
    const signer: OperatorSigner = { kind: "raw-key", walletClient };

    const roles = {
      northwind: privateKeyToAccount(northwindKey).address,
      meridian: privateKeyToAccount(meridianKey).address,
      atlas: privateKeyToAccount(atlasKey).address,
    };

    const registerResults = await registerFixtureInvoices({
      publicClient,
      signer,
      registry: deployment.registry,
      currency: deployment.usdc,
      chainId: BigInt(ARC_TESTNET_CHAIN_ID),
      roles,
      privateKeys: { northwind: northwindKey, meridian: meridianKey, atlas: atlasKey },
    });

    expect(registerResults).toHaveLength(3);
    for (const result of registerResults) {
      // Proves the client-side-computed id (`invoiceAttestationId`) matches the id the
      // contract actually stored the invoice under — getInvoice would revert InvoiceNotFound
      // otherwise. This is the cross-validation this whole test exists for.
      const onchain = await getInvoice(publicClient, deployment.registry, result.invoiceId);
      expect(onchain).not.toBeNull();
      expect(onchain?.amountRemaining).toBe(1_000_000_000n); // 1000 USDC, 6 decimals
      expect(onchain?.status).toBe(InvoiceStatus.Active);
    }

    const invoiceIds = registerResults.map((r) => r.invoiceId);

    const proposal = await proposeSettlement({ publicClient, registry: deployment.registry, invoiceIds });
    expect(proposal).not.toBeNull();
    expect(proposal?.invoiceIds).toHaveLength(3);
    expect(proposal?.wNet).toBe(1_000_000_000n);

    const settleResult = await settleBestCycle({
      publicClient,
      signer,
      registry: deployment.registry,
      settler: deployment.settler,
      invoiceIds,
    });

    expect(settleResult.wNet).toBe(1_000_000_000n);
    expect(settleResult.invoiceIds).toHaveLength(3);
    expect(settleResult.gasPaidWei).toBeGreaterThan(0n);

    // wNet equalled each invoice's full face value, so every invoice is now fully cancelled.
    for (const id of invoiceIds) {
      const onchain = await getInvoice(publicClient, deployment.registry, id);
      expect(onchain?.amountRemaining).toBe(0n);
      expect(onchain?.status).toBe(InvoiceStatus.ExtinguishedOnchain);
    }

    const tiles = computeDashboardTiles(settleResult);
    expect(tiles.grossCancelledUsdc).toBe(3_000_000_000n); // 3 x wNet
    expect(tiles.cashMovedUsdc).toBe(0n);
    expect(tiles.multiplier).toBeNull(); // cash moved is 0 — "no cash moved", not a divide-by-zero
  });

  it("runSettlementPipeline: registers a cycle plus one dangling invoice, settles the cycle, and correctly identifies the dangling one", async () => {
    // Debtor/creditor parties never send a transaction themselves (only sign attestations
    // off-chain) -- freshly generated keys, not anvil's fixed 10-account list, so nothing here
    // collides with addresses other `it()` blocks in this shared-anvil-instance file already
    // registered invoices for (anvil.privateKeys[0] is the only account used as a tx signer).
    const deployerKey = anvil.privateKeys[0] as `0x${string}`;
    const walletClient = createArcWalletClient(ARC_TESTNET_CHAIN_ID, deployerKey, anvil.rpcUrl);
    const signer: OperatorSigner = { kind: "raw-key", walletClient };
    const [aKey, bKey, cKey, dKey, eKey] = [
      generatePrivateKey(),
      generatePrivateKey(),
      generatePrivateKey(),
      generatePrivateKey(),
      generatePrivateKey(),
    ] as const;

    const A = privateKeyToAccount(aKey).address;
    const B = privateKeyToAccount(bKey).address;
    const C = privateKeyToAccount(cKey).address;
    const D = privateKeyToAccount(dKey).address;
    const E = privateKeyToAccount(eKey).address;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const chainId = BigInt(ARC_TESTNET_CHAIN_ID);

    function invoice(debtor: `0x${string}`, creditor: `0x${string}`, amount: bigint, invoiceRef: Hex) {
      return {
        invoiceRef,
        amount,
        currency: deployment.usdc,
        maturity: now + 30n * 24n * 60n * 60n,
        earlyNetConsent: true,
        debtor,
        creditor,
        nonce: 1n,
        registry: deployment.registry,
        chainId,
      };
    }

    const invoicesToRegister: PendingInvoice[] = [
      { label: "A->B", invoice: invoice(A, B, 1_000_000n, `0x${"1".repeat(64)}` as Hex), debtorPrivateKey: aKey, creditorPrivateKey: bKey },
      { label: "B->C", invoice: invoice(B, C, 1_000_000n, `0x${"2".repeat(64)}` as Hex), debtorPrivateKey: bKey, creditorPrivateKey: cKey },
      { label: "C->A", invoice: invoice(C, A, 1_000_000n, `0x${"3".repeat(64)}` as Hex), debtorPrivateKey: cKey, creditorPrivateKey: aKey },
      // Dangling -- D and E appear nowhere else, so no cycle can ever reach this invoice.
      { label: "D->E", invoice: invoice(D, E, 250_000n, `0x${"4".repeat(64)}` as Hex), debtorPrivateKey: dKey, creditorPrivateKey: eKey },
    ];

    const result = await runSettlementPipeline({
      publicClient,
      registerSigner: signer,
      settleSigner: signer,
      registry: deployment.registry,
      settler: deployment.settler,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      invoicesToRegister,
    });

    expect(result.registered).toHaveLength(4);
    expect(result.settle).not.toBeNull();
    expect(result.settle?.wNet).toBe(1_000_000n);
    expect(result.settle?.invoiceIds).toHaveLength(3);

    const danglingInvoiceId = result.registered.find((r) => r.label === "D->E")?.invoiceId;
    expect(result.danglingInvoiceIds).toEqual([danglingInvoiceId]);

    // No `residual` param given -- must not have attempted a quote or a fund, even though a
    // dangling invoice exists.
    expect(result.residualQuote).toBeUndefined();
    expect(result.residualFund).toBeUndefined();
    expect(result.residualFundError).toBeUndefined();

    expect(result.dashboardTiles).not.toBeNull();
    expect(result.dashboardTiles?.grossCancelledUsdc).toBe(3_000_000n); // 3 x wNet, cycle only

    // The dangling invoice is untouched -- still Active, full amount.
    const onchainDangling = await getInvoice(publicClient, deployment.registry, danglingInvoiceId!);
    expect(onchainDangling?.status).toBe(InvoiceStatus.Active);
    expect(onchainDangling?.amountRemaining).toBe(250_000n);
  });

  it("runSettlementPipeline: settle is null and every registered invoice is dangling when no cycle exists", async () => {
    const deployerKey = anvil.privateKeys[0] as `0x${string}`;
    const walletClient = createArcWalletClient(ARC_TESTNET_CHAIN_ID, deployerKey, anvil.rpcUrl);
    const signer: OperatorSigner = { kind: "raw-key", walletClient };
    const [fKey, gKey] = [generatePrivateKey(), generatePrivateKey()] as const;

    const F = privateKeyToAccount(fKey).address;
    const G = privateKeyToAccount(gKey).address;
    const now = BigInt(Math.floor(Date.now() / 1000));

    const invoicesToRegister: PendingInvoice[] = [
      {
        label: "F->G",
        invoice: {
          invoiceRef: `0x${"5".repeat(64)}` as Hex,
          amount: 500_000n,
          currency: deployment.usdc,
          maturity: now + 30n * 24n * 60n * 60n,
          earlyNetConsent: true,
          debtor: F,
          creditor: G,
          nonce: 1n,
          registry: deployment.registry,
          chainId: BigInt(ARC_TESTNET_CHAIN_ID),
        },
        debtorPrivateKey: fKey,
        creditorPrivateKey: gKey,
      },
    ];

    const result = await runSettlementPipeline({
      publicClient,
      registerSigner: signer,
      settleSigner: signer,
      registry: deployment.registry,
      settler: deployment.settler,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      invoicesToRegister,
    });

    expect(result.settle).toBeNull();
    expect(result.danglingInvoiceIds).toEqual([result.registered[0]?.invoiceId]);
    expect(result.dashboardTiles).toBeNull();
  });

  it("runSettlementPipeline: quotes and funds a residual only when the caller opts in via `residual`", async () => {
    const deployerKey = anvil.privateKeys[0] as `0x${string}`;
    const walletClient = createArcWalletClient(ARC_TESTNET_CHAIN_ID, deployerKey, anvil.rpcUrl);
    const signer: OperatorSigner = { kind: "raw-key", walletClient };
    const [hKey, iKey, jKey, kKey, lKey] = [
      generatePrivateKey(),
      generatePrivateKey(),
      generatePrivateKey(),
      generatePrivateKey(),
      generatePrivateKey(),
    ] as const;

    const H = privateKeyToAccount(hKey).address;
    const I = privateKeyToAccount(iKey).address;
    const J = privateKeyToAccount(jKey).address;
    const K = privateKeyToAccount(kKey).address;
    const L = privateKeyToAccount(lKey).address;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const chainId = BigInt(ARC_TESTNET_CHAIN_ID);

    function invoice(debtor: `0x${string}`, creditor: `0x${string}`, amount: bigint, invoiceRef: Hex) {
      return {
        invoiceRef,
        amount,
        currency: deployment.usdc,
        maturity: now + 30n * 24n * 60n * 60n,
        earlyNetConsent: true,
        debtor,
        creditor,
        nonce: 1n,
        registry: deployment.registry,
        chainId,
      };
    }

    const invoicesToRegister: PendingInvoice[] = [
      // H->I->L->H: a real 3-party cycle. The solver's default minCycleLength is 3 (see
      // packages/solver/src/cycles.ts) -- a 2-party H<->I pair is never proposed regardless of
      // amounts, so this needs a genuine 3-node closed walk, not just "any cycle shape".
      { label: "H->I", invoice: invoice(H, I, 1_000_000n, `0x${"6".repeat(64)}` as Hex), debtorPrivateKey: hKey, creditorPrivateKey: iKey },
      { label: "I->L", invoice: invoice(I, L, 1_000_000n, `0x${"7".repeat(64)}` as Hex), debtorPrivateKey: iKey, creditorPrivateKey: lKey },
      { label: "L->H", invoice: invoice(L, H, 1_000_000n, `0x${"9".repeat(64)}` as Hex), debtorPrivateKey: lKey, creditorPrivateKey: hKey },
      // Dangling, amount 0.30 USDC (300_000 base units) -- J/K appear in no cycle.
      { label: "J->K", invoice: invoice(J, K, 300_000n, `0x${"8".repeat(64)}` as Hex), debtorPrivateKey: jKey, creditorPrivateKey: kKey },
    ];

    // Stubbed Circle SDK surfaces -- same pattern swap.test.ts/unifiedBalance.test.ts use. Only
    // register()/settle() go through the real anvil chain here; the point of this test is that
    // the pipeline only calls these when `residual` is actually given.
    const estimateSwap = vi.fn().mockResolvedValue({ estimatedOutput: { amount: "0.27", token: "EURC" } });
    const swapKit = { kit: { estimateSwap } as never, adapter: {} as never, chain: "Arc_Testnet" as never };

    const deposit = vi.fn().mockResolvedValue({ txHash: "0xdep" });
    function balanceResult(confirmed: string) {
      return {
        totalConfirmedBalance: confirmed,
        breakdown: [{ depositor: "0xop", totalConfirmed: confirmed, breakdown: [{ chain: "Ethereum_Sepolia", confirmedBalance: confirmed }] }],
      };
    }
    const getBalances = vi
      .fn()
      .mockResolvedValueOnce(balanceResult("0.000000")) // pre-deposit "before" read
      .mockResolvedValueOnce(balanceResult("1.500000")); // poll 1: confirmed (0.30 dangling + 1.20 default margin)
    const spend = vi.fn().mockResolvedValue({ txHash: "0xspend" });
    const fundVia = {
      kit: { unifiedBalance: { deposit, getBalances, spend } } as never,
      adapter: {} as never,
    };

    const result = await runSettlementPipeline({
      publicClient,
      registerSigner: signer,
      settleSigner: signer,
      registry: deployment.registry,
      settler: deployment.settler,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      invoicesToRegister,
      residual: { swapKit, fundVia, sourceChain: "Ethereum_Sepolia" as never, pollIntervalMs: 1 },
    });

    expect(result.danglingInvoiceIds).toHaveLength(1);
    expect(estimateSwap).toHaveBeenCalledWith(expect.objectContaining({ amountIn: "0.300000" }));
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(spend).toHaveBeenCalledWith(expect.objectContaining({ amount: "0.300000" }));
    expect(result.residualQuote).toEqual({ estimatedOutput: { amount: "0.27", token: "EURC" } });
    expect(result.residualFund).toEqual({ txHash: "0xspend" });
    expect(result.residualFundError).toBeUndefined();
  });

  it("runSettlementPipeline: does not attempt a quote or fund when every registered invoice settles (no dangling amount)", async () => {
    const deployerKey = anvil.privateKeys[0] as `0x${string}`;
    const walletClient = createArcWalletClient(ARC_TESTNET_CHAIN_ID, deployerKey, anvil.rpcUrl);
    const signer: OperatorSigner = { kind: "raw-key", walletClient };
    const [mKey, nKey, oKey] = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()] as const;

    const M = privateKeyToAccount(mKey).address;
    const N = privateKeyToAccount(nKey).address;
    const O = privateKeyToAccount(oKey).address;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const chainId = BigInt(ARC_TESTNET_CHAIN_ID);

    function invoice(debtor: `0x${string}`, creditor: `0x${string}`, invoiceRef: Hex) {
      return {
        invoiceRef,
        amount: 1_000_000n,
        currency: deployment.usdc,
        maturity: now + 30n * 24n * 60n * 60n,
        earlyNetConsent: true,
        debtor,
        creditor,
        nonce: 1n,
        registry: deployment.registry,
        chainId,
      };
    }

    const invoicesToRegister: PendingInvoice[] = [
      { label: "M->N", invoice: invoice(M, N, `0x${"9".repeat(64)}` as Hex), debtorPrivateKey: mKey, creditorPrivateKey: nKey },
      { label: "N->O", invoice: invoice(N, O, `0x${"a".repeat(64)}` as Hex), debtorPrivateKey: nKey, creditorPrivateKey: oKey },
      { label: "O->M", invoice: invoice(O, M, `0x${"b".repeat(64)}` as Hex), debtorPrivateKey: oKey, creditorPrivateKey: mKey },
    ];

    const estimateSwap = vi.fn();
    const swapKit = { kit: { estimateSwap } as never, adapter: {} as never, chain: "Arc_Testnet" as never };

    const result = await runSettlementPipeline({
      publicClient,
      registerSigner: signer,
      settleSigner: signer,
      registry: deployment.registry,
      settler: deployment.settler,
      arcChainId: ARC_TESTNET_CHAIN_ID,
      invoicesToRegister,
      residual: { swapKit },
    });

    expect(result.danglingInvoiceIds).toHaveLength(0);
    expect(estimateSwap).not.toHaveBeenCalled();
    expect(result.residualQuote).toBeUndefined();
  });
});
