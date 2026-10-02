import { describe, expect, it, vi } from "vitest";
import type { Address, EIP1193Provider } from "viem";
import { prepareWalletContext } from "../src/attest/walletContext";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const targetChainId = 5042002;

function connectorFor(state: { address: Address; chainId: number }) {
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_accounts") return [state.address];
      if (method === "eth_chainId") return `0x${state.chainId.toString(16)}`;
      throw new Error(`Unexpected method ${method}`);
    }),
  } as unknown as EIP1193Provider;
  return { getProvider: async () => provider };
}

describe("prepareWalletContext", () => {
  it("switches to the requested chain and verifies account and chain afterward", async () => {
    const state = { address: owner, chainId: 1 };
    const switchChain = vi.fn(async ({ chainId }: { chainId: number }) => {
      state.chainId = chainId;
    });
    await expect(prepareWalletContext(connectorFor(state), owner, targetChainId, switchChain)).resolves.toBeUndefined();
    expect(switchChain).toHaveBeenCalledWith({ chainId: targetChainId });
  });

  it("does not switch or sign under a mismatched account", async () => {
    const switchChain = vi.fn();
    await expect(prepareWalletContext(connectorFor({ address: other, chainId: 1 }), owner, targetChainId, switchChain))
      .rejects.toThrow("does not match");
    expect(switchChain).not.toHaveBeenCalled();
  });

  it("rejects a wallet that fails to switch to the requested network", async () => {
    const switchChain = vi.fn(async () => undefined);
    await expect(prepareWalletContext(connectorFor({ address: owner, chainId: 1 }), owner, targetChainId, switchChain))
      .rejects.toThrow("network changed");
  });
});
