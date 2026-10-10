/// The real-invoice Settle path against compiled contracts on a local anvil chain: three invoices
/// registered, the caller-rooted loop search over the Registry's own events, then `settle()`
/// signed and paid by a party's own wallet (no operator relay), checked onchain afterwards.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, PublicClient } from "viem";
import { startAnvil, type AnvilInstance } from "./helpers/anvil";
import { deployContraflowLocally, contraflowRegistryAbi, contraflowSettlerAbi, type LocalDeployment } from "./helpers/localDeploy";
import { createArcPublicClient, createArcWalletClient } from "../src/chain/client";
import { ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import { registerFixtureInvoices } from "../src/actions/register";
import { fetchNettableInvoiceEdges, getInvoice, InvoiceStatus } from "../src/chain/readInvoices";
import { findInvoiceLoopFor } from "../src/settle/invoiceLoops";
import type { DecodedLog } from "../src/blockscout/client";
import type { OperatorSigner } from "../src/operator/signer";

const PORT = 8913;

/// The Registry's InvoiceRegistered events in the explorer's decoded shape, newest first.
async function registeredLogs(client: PublicClient, registry: Hex): Promise<DecodedLog[]> {
  const events = await client.getContractEvents({ address: registry, abi: contraflowRegistryAbi, eventName: "InvoiceRegistered", fromBlock: 0n });
  return events
    .map((event) => {
      const args = (event as unknown as { args: Record<string, unknown> }).args;
      return {
        address: registry,
        transactionHash: event.transactionHash!,
        blockNumber: Number(event.blockNumber),
        logIndex: event.logIndex ?? 0,
        methodCall: "InvoiceRegistered(bytes32 indexed id, address indexed debtor, address indexed creditor, uint256 amount, uint64 maturity, bool earlyNetConsent, uint256 nonce)",
        parameters: [
          { name: "id", type: "bytes32", value: String(args.id) },
          { name: "debtor", type: "address", value: String(args.debtor) },
          { name: "creditor", type: "address", value: String(args.creditor) },
          { name: "amount", type: "uint256", value: String(args.amount) },
          { name: "maturity", type: "uint64", value: String(args.maturity) },
          { name: "earlyNetConsent", type: "bool", value: String(args.earlyNetConsent) },
          { name: "nonce", type: "uint256", value: String(args.nonce) },
        ],
      } satisfies DecodedLog;
    })
    .reverse();
}

describe("real invoice settle (local anvil)", () => {
  let anvil: AnvilInstance;
  let deployment: LocalDeployment;
  let publicClient: PublicClient;

  beforeAll(async () => {
    anvil = await startAnvil(PORT, ARC_TESTNET_CHAIN_ID);
    const deployerKey = anvil.privateKeys[0]!;
    const deployerAddress = privateKeyToAccount(deployerKey).address;
    deployment = await deployContraflowLocally({
      rpcUrl: anvil.rpcUrl,
      deployerPrivateKey: deployerKey,
      ownerAddress: deployerAddress,
      usdcPlaceholder: deployerAddress,
    });
    publicClient = createArcPublicClient(ARC_TESTNET_CHAIN_ID, anvil.rpcUrl) as PublicClient;
  }, 20_000);

  afterAll(() => anvil?.stop());

  it("registers three, finds the caller's loop, settles from the party's own wallet", async () => {
    const [deployerKey, northwindKey, meridianKey, atlasKey] = anvil.privateKeys as [Hex, Hex, Hex, Hex, ...Hex[]];
    const signer: OperatorSigner = { kind: "raw-key", walletClient: createArcWalletClient(ARC_TESTNET_CHAIN_ID, deployerKey, anvil.rpcUrl) };
    const roles = {
      northwind: privateKeyToAccount(northwindKey).address,
      meridian: privateKeyToAccount(meridianKey).address,
      atlas: privateKeyToAccount(atlasKey).address,
    };
    const registered = await registerFixtureInvoices({
      publicClient,
      signer,
      registry: deployment.registry,
      currency: deployment.usdc,
      chainId: BigInt(ARC_TESTNET_CHAIN_ID),
      roles,
      privateKeys: { northwind: northwindKey, meridian: meridianKey, atlas: atlasKey },
    });

    const logs = await registeredLogs(publicClient, deployment.registry);
    const found = await findInvoiceLoopFor(roles.northwind, {
      fetchLogs: async () => ({ logs, truncated: false }),
      fetchNettable: (ids) => fetchNettableInvoiceEdges(publicClient, deployment.registry, ids),
      filterFlagged: async (edges) => edges,
    });
    expect(found.kind).toBe("loop");
    if (found.kind !== "loop") return;
    expect(new Set(found.invoiceIds.map((id) => id.toLowerCase()))).toEqual(new Set(registered.map((r) => r.invoiceId.toLowerCase())));

    // The party itself signs and pays; nothing goes through the operator signer.
    const party = createArcWalletClient(ARC_TESTNET_CHAIN_ID, northwindKey, anvil.rpcUrl);
    const { request } = await publicClient.simulateContract({
      address: deployment.settler,
      abi: contraflowSettlerAbi,
      functionName: "settle",
      args: [found.invoiceIds, found.wNet],
      account: party.account!,
    });
    const hash = await party.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
    expect(receipt.from.toLowerCase()).toBe(roles.northwind.toLowerCase());

    for (const id of found.invoiceIds) {
      const onchain = await getInvoice(publicClient, deployment.registry, id);
      expect(onchain?.amountRemaining).toBe(0n);
      expect(onchain?.status).toBe(InvoiceStatus.ExtinguishedOnchain);
    }

    // Once settled, the same search finds nothing left to net.
    const after = await findInvoiceLoopFor(roles.northwind, {
      fetchLogs: async () => ({ logs, truncated: false }),
      fetchNettable: (ids) => fetchNettableInvoiceEdges(publicClient, deployment.registry, ids),
      filterFlagged: async (edges) => edges,
    });
    expect(after.kind).toBe("none");
  });
});
