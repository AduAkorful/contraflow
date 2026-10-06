"use client";

import { useAccount, useSignTypedData as useWagmiSignTypedData } from "wagmi";
import { useSignTypedData as usePrivySignTypedData, useWallets } from "@privy-io/react-auth";
import { typedDataUiRoute } from "../../src/format/signing";

type TypedDataPayload = {
  domain: object;
  types: object;
  primaryType: string;
  message: object;
};

/// Routes typed-data signing: Privy embedded wallets get a titled confirmation popup; external
/// wallets keep wagmi (MetaMask, etc. show their own prompt).

export function useContraflowSignTypedData() {
  const { address } = useAccount();
  const { wallets } = useWallets();
  const { signTypedDataAsync } = useWagmiSignTypedData();
  const { signTypedData: signTypedDataPrivy } = usePrivySignTypedData();

  async function signTypedData(
    typedData: TypedDataPayload,
    ui: { title: string; description: string },
  ): Promise<`0x${string}`> {
    const wallet = wallets.find((w) => w.address.toLowerCase() === address?.toLowerCase());
    if (typedDataUiRoute(wallet?.walletClientType) === "privy") {
      const result = await signTypedDataPrivy(typedData as never, {
        uiOptions: { title: ui.title, description: ui.description },
        address: wallet?.address,
      });
      return result.signature as `0x${string}`;
    }
    return signTypedDataAsync(typedData as never);
  }

  return { signTypedData };
}
