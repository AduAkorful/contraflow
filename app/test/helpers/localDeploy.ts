/// Deploys real, compiled `ContraflowRegistry`/`ContraflowSettler` (implementation + ERC1967Proxy
/// pairs) to a local anvil instance, mirroring `contracts/script/Deploy.s.sol`'s atomic
/// construct-and-initialize pattern in TypeScript, purely for this test suite. Deliberately
/// separate from the real `Deploy.s.sol` (which refuses to run against anything but Arc
/// testnet's chain id and writes `contracts/deployments/testnet.json`) so a test run can never
/// touch that file or the real deployment record.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  getContractAddress,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "../../src/chain/client";
import { contraflowRegistryAbi, contraflowSettlerAbi } from "../../src/contracts/abi/index";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

function readArtifact(path: string): { abi: Abi; bytecode: { object: Hex } } {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

const registryArtifact = readArtifact("contracts/out/ContraflowRegistry.sol/ContraflowRegistry.json");
const settlerArtifact = readArtifact("contracts/out/ContraflowSettler.sol/ContraflowSettler.json");
const proxyArtifact = readArtifact("contracts/out/ERC1967Proxy.sol/ERC1967Proxy.json");

export interface LocalDeployment {
  registry: Address;
  settler: Address;
  usdc: Address;
  owner: Address;
}

export async function deployContraflowLocally(params: {
  rpcUrl: string;
  deployerPrivateKey: Hex;
  ownerAddress: Address;
  /// Inert placeholder — `register()`/`settle()` never call the token contract, so this
  /// address doesn't need real ERC-20 bytecode behind it on the local chain.
  usdcPlaceholder: Address;
}): Promise<LocalDeployment> {
  const { rpcUrl, deployerPrivateKey, ownerAddress, usdcPlaceholder } = params;

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
  const deployerAccount = privateKeyToAccount(deployerPrivateKey);
  const walletClient = createWalletClient({ account: deployerAccount, chain: arcTestnet, transport: http(rpcUrl) });

  const registryImplHash = await walletClient.deployContract({
    abi: registryArtifact.abi,
    bytecode: registryArtifact.bytecode.object,
    args: [],
  });
  const registryImplReceipt = await publicClient.waitForTransactionReceipt({ hash: registryImplHash });
  const registryImpl = requireContractAddress(registryImplReceipt);

  const settlerImplHash = await walletClient.deployContract({
    abi: settlerArtifact.abi,
    bytecode: settlerArtifact.bytecode.object,
    args: [],
  });
  const settlerImplReceipt = await publicClient.waitForTransactionReceipt({ hash: settlerImplHash });
  const settlerImpl = requireContractAddress(settlerImplReceipt);

  // Same nonce-prediction the real Deploy.s.sol uses: captured *after* both implementation
  // deploys (see that script's own doc comment on why order matters here), predicting the
  // slot the Settler proxy will land in once the Registry proxy is deployed first.
  const nonceAfterImpls = await publicClient.getTransactionCount({ address: deployerAccount.address });
  const predictedSettlerProxy = getContractAddress({ from: deployerAccount.address, nonce: BigInt(nonceAfterImpls + 1) });

  const registryProxyHash = await walletClient.deployContract({
    abi: proxyArtifact.abi,
    bytecode: proxyArtifact.bytecode.object,
    args: [
      registryImpl,
      encodeFunctionData({
        abi: registryArtifact.abi,
        functionName: "initialize",
        args: [usdcPlaceholder, predictedSettlerProxy, ownerAddress],
      }),
    ],
  });
  const registryProxyReceipt = await publicClient.waitForTransactionReceipt({ hash: registryProxyHash });
  const registryProxy = requireContractAddress(registryProxyReceipt);

  const settlerProxyHash = await walletClient.deployContract({
    abi: proxyArtifact.abi,
    bytecode: proxyArtifact.bytecode.object,
    args: [
      settlerImpl,
      encodeFunctionData({
        abi: settlerArtifact.abi,
        functionName: "initialize",
        args: [registryProxy, ownerAddress],
      }),
    ],
  });
  const settlerProxyReceipt = await publicClient.waitForTransactionReceipt({ hash: settlerProxyHash });
  const settlerProxy = requireContractAddress(settlerProxyReceipt);

  if (settlerProxy.toLowerCase() !== predictedSettlerProxy.toLowerCase()) {
    throw new Error(
      `deployContraflowLocally: predicted Settler proxy ${predictedSettlerProxy} but got ${settlerProxy} — nonce accounting drifted`,
    );
  }

  return { registry: registryProxy, settler: settlerProxy, usdc: usdcPlaceholder, owner: ownerAddress };
}

function requireContractAddress(receipt: { contractAddress: Address | null | undefined }): Address {
  if (!receipt.contractAddress) throw new Error("deployContraflowLocally: receipt missing contractAddress");
  return receipt.contractAddress;
}

// Re-exported so callers don't need a second import just for ABI access in assertions.
export { contraflowRegistryAbi, contraflowSettlerAbi };
