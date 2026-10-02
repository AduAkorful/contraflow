import { isAddressEqual, type Address, type EIP1193Provider } from "viem";

export interface WalletContextConnector {
  getProvider(): Promise<unknown>;
}

export type SwitchChain = (args: { chainId: number }) => Promise<unknown>;

async function readWalletContext(connector: WalletContextConnector): Promise<{ address: Address; chainId: number }> {
  const provider = (await connector.getProvider()) as EIP1193Provider;
  if (!provider || typeof provider.request !== "function") throw new Error("Your wallet provider could not be verified.");
  const [accounts, chainIdHex] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
  ]);
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof address !== "string" || !/^0x[0-9a-f]{40}$/i.test(address)) throw new Error("Connect your invoice wallet and try again.");
  if (typeof chainIdHex !== "string" || !/^0x[0-9a-f]+$/i.test(chainIdHex)) throw new Error("Your wallet network could not be verified.");
  return { address: address as Address, chainId: Number.parseInt(chainIdHex, 16) };
}

async function assertWalletContext(connector: WalletContextConnector, expectedAddress: Address, chainId: number): Promise<void> {
  const actual = await readWalletContext(connector);
  if (!isAddressEqual(actual.address, expectedAddress)) throw new Error("Your wallet account changed. Reconnect the wallet signed in to Contraflow and try again.");
  if (actual.chainId !== chainId) throw new Error("Your wallet network changed. Switch back to Arc Testnet and try again.");
}

/// Switches to the required chain and confirms the wallet still exposes the expected account.
/// Call again after wallet signature prompts and immediately before a write action.
export async function prepareWalletContext(
  connector: WalletContextConnector | undefined,
  expectedAddress: Address,
  chainId: number,
  switchChain: SwitchChain,
): Promise<void> {
  if (!connector) throw new Error("Connect your invoice wallet and try again.");
  const before = await readWalletContext(connector);
  if (!isAddressEqual(before.address, expectedAddress)) throw new Error("Your wallet account does not match the wallet signed in to Contraflow.");
  if (before.chainId !== chainId) {
    try {
      await switchChain({ chainId });
    } catch {
      throw new Error("Switch your wallet to Arc Testnet to continue. Nothing was signed or sent.");
    }
  }
  await assertWalletContext(connector, expectedAddress, chainId);
}
